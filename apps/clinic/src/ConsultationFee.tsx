import { useEffect, useState, type FormEvent } from 'react';
import { addConsultationCharge, BillingApiError, readConsultationFee, type ConsultationFeeStatus } from './billingApi';
import { formatPaise, rupeesToPaise } from './billingMoney';

interface Props {
  clinicSlug: string;
  appointmentId: string;
  clinicDate: string;
  patientName: string;
  appointmentStatus: string;
  encounterStatus: 'draft' | 'finalized';
  csrfToken: string;
  onSessionLost: () => void;
  onBusyChange: (busy: boolean) => void;
}

export default function ConsultationFee({ clinicSlug, appointmentId, clinicDate, patientName, appointmentStatus, encounterStatus, csrfToken, onSessionLost, onBusyChange }: Props) {
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState<ConsultationFeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => { onBusyChange(pending); }, [pending, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setStatus(null); setError(''); setSuccess('');
    void readConsultationFee(clinicSlug, { appointmentId, clinicDate }, csrfToken, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setStatus(value); setBlocked(false); }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof BillingApiError && cause.status === 401) onSessionLost();
      else setError(cause instanceof BillingApiError && cause.status === 403
        ? 'This fee is available only for your assigned visit.'
        : 'Consultation fee could not be checked. Refresh this section.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, appointmentId, clinicDate, csrfToken, reload, onSessionLost]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status || status.amountPaise !== null || loading || pending || blocked || !confirmed) return;
    const amountPaise = rupeesToPaise(amount);
    if (!amountPaise || amountPaise > 100_000_000) { setError('Enter a fee from ₹0.01 to ₹10,00,000.00.'); return; }
    const operationId = globalThis.crypto?.randomUUID?.();
    if (!operationId) { setError('This browser cannot create a safe operation ID. No fee was submitted.'); return; }
    setPending(true); setError(''); setSuccess('');
    try {
      const episode = await addConsultationCharge(clinicSlug, { appointmentId, clinicDate }, status.revision, amountPaise, operationId, csrfToken);
      setStatus({ amountPaise: episode.consultationTotalPaise, revision: episode.revision });
      setAmount(''); setConfirmed(false);
      setSuccess('Consultation fee saved for this visit. Reception will see the same amount after refreshing.');
    } catch (cause) {
      if (cause instanceof BillingApiError && cause.status === 401) onSessionLost();
      else {
        setBlocked(true); setConfirmed(false);
        setError(cause instanceof BillingApiError && cause.status === 409
          ? 'This fee or bill changed. Refresh before taking another action.'
          : cause instanceof BillingApiError && cause.status === 403
            ? 'This visit is not assigned to your account.'
            : 'The fee outcome could not be confirmed. Refresh before trying again.');
      }
    } finally { setPending(false); }
  }

  const eligible = appointmentStatus === 'checked_in' || encounterStatus === 'finalized';
  return <section className="workflow-card consultation-section consultation-fee" aria-labelledby="doctor-fee-heading">
    <div className="workflow-card-head"><div><h4 id="doctor-fee-heading">Consultation fee</h4></div><p>Optional for the assigned doctor. Reception can enter the fee instead.</p></div>
    {loading ? <p className="workflow-muted" role="status">Checking fee…</p> : status?.amountPaise !== null && status ? <p className="workflow-success">Fee saved for {patientName}: <strong>{formatPaise(status.amountPaise)}</strong>. Reception uses this same amount.</p> : status && eligible ? <form className="doctor-fee-form" onSubmit={(event) => void save(event)}>
      <label>Fee for this visit (₹)<input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setConfirmed(false); }} placeholder="0.00" disabled={pending || blocked} required /></label>
      <label className="billing-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={pending || blocked} /> I confirm this fee for {patientName}.</label>
      <button className="workflow-action" type="submit" disabled={!confirmed || pending || blocked}>{pending ? 'Saving…' : 'Save consultation fee'}</button>
    </form> : status && <p className="workflow-hint">The patient must be checked in before a fee can be added. Refresh the daily schedule after reception confirms arrival.</p>}
    {error && <p className="workflow-error" role="alert">{error}</p>}{success && <p className="workflow-success" role="status">{success}</p>}
    {(error || blocked) && <button type="button" className="workflow-link" onClick={() => setReload((value) => value + 1)} disabled={pending || loading}>Refresh fee</button>}
  </section>;
}
