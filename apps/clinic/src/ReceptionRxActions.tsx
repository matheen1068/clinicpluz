import { useEffect, useState } from 'react';
import { BillingApiError, closeOutsidePharmacy, readBillingEpisode, type Episode } from './billingApi';
import type { PrintablePrescription } from './consultationApi';
import { formatDay } from './FollowUpPlan';
import type { PrescriptionQueueItem } from './prescriptionApi';

export interface BookingPrefill { patientName: string; doctorId: string; date: string; purpose: string; token: number }

interface Props {
  clinicSlug: string; csrfToken: string; selected: PrescriptionQueueItem; prescription: PrintablePrescription;
  onSessionLost: () => void; onPendingChange: (pending: boolean) => void;
  onBookFollowUp: (prefill: Omit<BookingPrefill, 'token'>) => void;
}

function operationId(): string | null { return typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : null; }

export default function ReceptionRxActions({ clinicSlug, csrfToken, selected, prescription, onSessionLost, onPendingChange, onBookFollowUp }: Props) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'nobill' | 'error'>('loading');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading'); setEpisode(null);
    readBillingEpisode(clinicSlug, selected, csrfToken, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setEpisode(value.episode); setState('ready');
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof BillingApiError && failure.status === 401) { onSessionLost(); return; }
      setState(failure instanceof BillingApiError && failure.status === 404 ? 'nobill' : 'error');
    });
    return () => controller.abort();
  }, [clinicSlug, csrfToken, selected]);

  const closed = episode?.pharmacyDisposition === 'closed' || episode?.pharmacyDisposition === 'not_required';
  const supplyStarted = !!episode && (episode.pharmacyTotalPaise > 0 || episode.pharmacyDisposition === 'open');
  const canClose = !!episode && !closed && !supplyStarted && !episode.receiptIssued && !pending;

  async function close() {
    if (!episode || !canClose || !confirmed || !prescription.revision) return;
    const id = operationId();
    if (!id) { setError('This browser cannot create a safe operation ID. Nothing was changed.'); return; }
    setPending(true); setError(''); setMessage('');
    try {
      const next = await closeOutsidePharmacy(clinicSlug, selected, episode.revision, prescription.revision, id, csrfToken);
      setEpisode(next); setConfirmed(false);
      setMessage('Pharmacy closed: patient buys medicines outside. The visit can now go to checkout.');
    } catch (failure) {
      if (failure instanceof BillingApiError && failure.status === 401) { onSessionLost(); return; }
      setError(failure instanceof BillingApiError && failure.status === 409
        ? 'The bill or pharmacy status changed. Reopen this prescription to see the latest status.'
        : 'Could not confirm the result. Reopen this prescription and check its status before trying again.');
    } finally { setPending(false); }
  }

  return <div className="reception-rx-actions">
    {prescription.followUp && <div className="followup-banner" role="group" aria-label="Follow-up visit">
      <strong>Next visit: {formatDay(prescription.followUp.date)}</strong>
      {prescription.followUp.purpose && <span>Purpose: {prescription.followUp.purpose}</span>}
      {prescription.followUp.bring && <span>Please bring: {prescription.followUp.bring}</span>}
      <button type="button" className="workflow-action" onClick={() => onBookFollowUp({
        patientName: prescription.patient.fullName, doctorId: selected.doctorId, date: prescription.followUp!.date,
        purpose: prescription.followUp!.purpose })}>Book this follow-up</button>
    </div>}
    <div className="billing-action-box">
      <h6>Medicines from the clinic pharmacy?</h6>
      {state === 'loading' ? <p className="workflow-muted" role="status">Checking this visit’s bill…</p>
        : state === 'nobill' ? <p className="workflow-hint">No bill exists for this visit yet. Check the patient in and post the consultation fee first. You can still print the prescription above.</p>
        : state === 'error' || !episode ? <p className="workflow-hint">The bill could not be checked right now. You can still print the prescription above.</p>
        : closed ? <p className="workflow-success" role="status">Pharmacy step is closed{episode.pharmacyTotalPaise > 0 ? ' (medicines supplied by the clinic pharmacy)' : ' (patient buys medicines outside)'}.</p>
        : supplyStarted ? <p className="workflow-hint">The pharmacist has already started this order, so only the pharmacist can close it.</p>
        : <>
          <p>If the patient will buy these medicines elsewhere, close the pharmacy step so the visit can be paid and receipted. Printing the prescription never depends on this.</p>
          <label className="workflow-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={pending} /> Patient will buy the medicines outside the clinic</label>
          <button type="button" className="workflow-action" onClick={() => void close()} disabled={!confirmed || pending || !prescription.revision}>{pending ? 'Closing…' : 'Close pharmacy: buying outside'}</button>
        </>}
      {message && <p className="workflow-success" role="status">{message}</p>}
      {error && <p className="workflow-error" role="alert">{error}</p>}
    </div>
  </div>;
}
