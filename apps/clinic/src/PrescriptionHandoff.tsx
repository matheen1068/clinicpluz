import { useEffect, useRef, useState } from 'react';
import { ConsultationApiError, type PrintablePrescription } from './consultationApi';
import { medicationTimingText } from './medicationDirections';
import PrescriptionPrint from './PrescriptionPrint';
import PrescriptionEmail from './PrescriptionEmail';
import { listFinalizedPrescriptions, readFinalizedPrescription, type PrescriptionQueueItem } from './prescriptionApi';
import { pilotDateToday } from './workflowApi';

interface Props {
  clinicSlug: string;
  csrfToken: string;
  role: 'receptionist' | 'pharmacist';
  onSessionLost: () => void;
  onPendingChange?: (pending: boolean) => void;
}

function clinicTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

export default function PrescriptionHandoff({ clinicSlug, csrfToken, role, onSessionLost, onPendingChange }: Props) {
  const [date, setDate] = useState(pilotDateToday);
  const [items, setItems] = useState<PrescriptionQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [refreshError, setRefreshError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<PrescriptionQueueItem | null>(null);
  const [prescription, setPrescription] = useState<PrintablePrescription | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const sessionLostRef = useRef(onSessionLost);
  useEffect(() => { sessionLostRef.current = onSessionLost; }, [onSessionLost]);
  useEffect(() => { onPendingChange?.(emailSending); }, [emailSending, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);

  function handleAccessError(error: unknown): boolean {
    if (!(error instanceof ConsultationApiError)) return false;
    if (error.status === 401) {
      detailController.current?.abort(); setItems([]); setSelected(null); setPrescription(null);
      sessionLostRef.current();
      return true;
    }
    if (error.status === 403) {
      detailController.current?.abort(); setItems([]); setSelected(null); setPrescription(null);
      setAccessDenied(true);
      return true;
    }
    return false;
  }

  useEffect(() => {
    const controller = new AbortController();
    detailController.current?.abort();
    setItems([]); setSelected(null); setPrescription(null); setDetailError('');
    setAccessDenied(false); setListError(''); setRefreshError(false); setLoading(true); setDetailLoading(false);
    void listFinalizedPrescriptions(clinicSlug, date, controller.signal).then((value) => {
      if (!controller.signal.aborted) setItems(value);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !handleAccessError(error)) setListError('Finalized prescriptions could not be loaded. Retry when the clinic service is available.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, date, reload]);
  useEffect(() => () => detailController.current?.abort(), []);

  useEffect(() => {
    if (loading || listError || accessDenied || emailSending) return;
    const controller = new AbortController();
    let inFlight = false;
    function refreshVisibleList() {
      if (document.visibilityState !== 'visible' || inFlight) return;
      inFlight = true;
      void listFinalizedPrescriptions(clinicSlug, date, controller.signal).then((value) => {
        if (!controller.signal.aborted) { setItems(value); setRefreshError(false); }
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && !handleAccessError(error)) setRefreshError(true);
      }).finally(() => { inFlight = false; });
    }
    const interval = window.setInterval(refreshVisibleList, 60_000);
    document.addEventListener('visibilitychange', refreshVisibleList);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisibleList);
      controller.abort();
    };
  }, [clinicSlug, date, loading, listError, accessDenied, emailSending]);

  function clearSelection() {
    detailController.current?.abort();
    setSelected(null); setPrescription(null); setDetailError(''); setDetailLoading(false);
  }
  function refreshList() {
    if (emailSending) return;
    clearSelection();
    setItems([]);
    setReload((value) => value + 1);
  }
  function changeDate(nextDate: string) {
    if (nextDate === date || emailSending) return;
    clearSelection();
    setItems([]);
    setDate(nextDate);
  }

  async function openPrescription(item: PrescriptionQueueItem) {
    if (emailSending) return;
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setSelected(item); setPrescription(null); setDetailError(''); setDetailLoading(true);
    try {
      const value = await readFinalizedPrescription(clinicSlug, item, csrfToken, controller.signal);
      if (!controller.signal.aborted) setPrescription(value);
    } catch (error) {
      if (!controller.signal.aborted && !handleAccessError(error)) {
        setDetailError(error instanceof ConsultationApiError && error.status === 404
          ? 'This finalized prescription is no longer available. Refresh the list.'
          : 'The finalized prescription could not be verified. No details are shown.');
      }
    } finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }

  if (accessDenied) return <section className="workflow-access" role="alert"><h3>Prescription handoff unavailable</h3><p>This clinic or staff role does not have access to finalized medicine orders.</p></section>;

  return <div className="prescription-handoff">
    <div className="workflow-intro"><div><span className="eyebrow">CLINIC HANDOFF</span><h3>{role === 'pharmacist' ? 'Pharmacy medicine orders' : 'Finalized prescriptions'}</h3><p>View doctor-finalized medicines for the selected clinic day. Drafts and clinical notes are not shown here.</p></div><span className="workflow-pilot">Synthetic pilot only</span></div>
    <p className="workflow-notice">Read-only medicine handoff. Reception controls bookings; only the assigned doctor edits or finalizes a prescription. Do not use real patient data in staging.</p>
    <section className="workflow-card" aria-labelledby="handoff-heading">
      <div className="workflow-card-head prescription-handoff-head"><div><span className="workflow-step">RX</span><h4 id="handoff-heading">Finalized medicine orders</h4></div><div className="consultation-queue-controls"><label>Clinic date<input type="date" value={date} onChange={(event) => changeDate(event.target.value)} disabled={emailSending} /></label><button type="button" className="workflow-link" onClick={refreshList} disabled={loading || emailSending}>Refresh list</button></div></div>
      <p className="workflow-muted">New finalized orders appear automatically while this page is open and visible, usually within a minute.</p>
      {refreshError && <p role="status" className="workflow-error">Could not refresh the list just now. Showing the last loaded result; use Refresh list to retry.</p>}
      {loading ? <p role="status" className="workflow-muted">Loading finalized prescriptions…</p>
        : listError ? <div role="alert" className="workflow-error"><p>{listError}</p><button type="button" className="workflow-link" onClick={refreshList}>Retry list</button></div>
        : items.length === 0 ? <p role="status" className="workflow-empty">No finalized prescriptions with medicines are recorded for {date}.</p>
        : <div className="prescription-handoff-layout">
          <div className="prescription-handoff-list" aria-label="Finalized prescriptions">{items.map((item) => <button type="button" key={item.appointmentId}
            className={`prescription-handoff-item${selected?.appointmentId === item.appointmentId ? ' is-selected' : ''}`}
            aria-pressed={selected?.appointmentId === item.appointmentId} onClick={() => void openPrescription(item)} disabled={emailSending}>
            <strong>{item.patientName}</strong><span>{item.doctorName} · {clinicTime(item.startAt)}</span><small>Finalized {clinicTime(item.finalizedAt)}</small>
          </button>)}</div>
          <div className="prescription-handoff-detail">
            {!selected ? <p className="workflow-empty">Select a finalized prescription to view its medicines.</p>
              : detailLoading ? <p role="status" className="workflow-muted">Verifying finalized prescription…</p>
              : detailError || !prescription ? <div role="alert" className="workflow-error"><p>{detailError || 'The selected prescription could not be verified.'}</p><button type="button" className="workflow-link" onClick={() => void openPrescription(selected)}>Retry prescription</button></div>
              : <><div className="prescription-handoff-person"><span className="eyebrow">SERVER-CONFIRMED FINAL</span><h5>{prescription.patient.fullName}</h5><p>{prescription.patient.ageYears} years at registration · {prescription.patient.sex}</p><p>Doctor: {prescription.doctor.displayName} · Finalized: {clinicTime(prescription.finalizedAt)}</p></div>
                <h6>Doctor-entered medicines</h6><ol>{prescription.medications.map((medicine, index) => <li key={index}><strong>{medicine.name} {medicine.strength}</strong><p>Dose: {medicine.dose} · Route: {medicine.route}</p><p>{medicationTimingText(medicine)} · Duration: {medicine.duration}</p><p>Instructions: {medicine.instructions}</p></li>)}</ol>
                <button type="button" className="workflow-action prescription-handoff-print" onClick={() => window.print()}>Print finalized prescription</button>
                {role === 'receptionist' && <PrescriptionEmail key={`${selected.appointmentId}:${selected.clinicDate}:${selected.finalizedAt}`} clinicSlug={clinicSlug} csrfToken={csrfToken} selection={selected} onAccessError={handleAccessError} onSendingChange={setEmailSending} />}
              </>}
          </div>
        </div>}
    </section>
    {prescription && <PrescriptionPrint prescription={prescription} />}
  </div>;
}
