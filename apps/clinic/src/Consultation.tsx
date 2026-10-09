import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClinicRole } from './api';
import {
  ConsultationApiError, finalizeEncounter, getConsultationQueue, readEncounter, saveDraft, saveVitals,
  type ConsultationNote, type ConsultationQueueItem, type Encounter, type Medication,
} from './consultationApi';
import { completeForFinalize, emptyMedication, emptyNote, mergeRecoveredFields, parseVitalForm, snapshotEdits, VITAL_FIELDS, vitalFormFrom, type RecoverySnapshot, type VitalForm } from './consultationForm';
import { pilotDateToday } from './workflowApi';

interface Props {
  clinicSlug: string;
  csrfToken: string;
  role: ClinicRole;
  onSessionLost: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
}

const NOTE_FIELDS = [
  { key: 'chiefComplaint', label: 'Chief complaint' },
  { key: 'history', label: 'History' },
  { key: 'exam', label: 'Examination' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan' },
] as const;
const MEDICATION_FIELDS = [
  { key: 'name', label: 'Medicine name' },
  { key: 'strength', label: 'Strength' },
  { key: 'dose', label: 'Dose' },
  { key: 'route', label: 'Route' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'duration', label: 'Duration' },
  { key: 'instructions', label: 'Instructions' },
] as const;

function RecoveryCopy({ snapshot, doctorRole, canRestore, onRestore, onDiscard }: {
  snapshot: RecoverySnapshot;
  doctorRole: boolean;
  canRestore: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return <section className="workflow-card consultation-recovery" aria-labelledby="recovery-heading">
    <h4 id="recovery-heading">Local edits kept for review</h4>
    <p>{canRestore ? 'The server record has been reloaded. Compare it with the local changes below before deciding what to keep.' : 'These unsaved changes remain available here while the server record cannot be edited.'} This copy exists only in this open browser tab.</p>
    <details><summary>Show local edits</summary><div className="consultation-recovery-content">
      {Object.keys(snapshot.vitalChanges).length > 0 && <div><strong>Changed observed time and vitals</strong>{snapshot.localObservedAt && <p>Local observation time: {snapshot.localObservedAt}</p>}<ul>{snapshot.vitalChanges.observedAt !== undefined && <li>Observed at: {snapshot.vitalChanges.observedAt || '—'}</li>}{VITAL_FIELDS.filter(({ key }) => snapshot.vitalChanges[key] !== undefined).map(({ key, label, unit }) => <li key={key}>{label}: {snapshot.vitalChanges[key] || '—'} {unit}</li>)}</ul></div>}
      {doctorRole && <>{Object.keys(snapshot.noteChanges).length > 0 && <div><strong>Changed doctor note fields</strong>{NOTE_FIELDS.filter(({ key }) => snapshot.noteChanges[key] !== undefined).map(({ key, label }) => <p key={key}><strong>{label}:</strong> {snapshot.noteChanges[key] || '—'}</p>)}</div>}{snapshot.medications !== null && <div><strong>Changed doctor-entered medicine list</strong>{snapshot.medications.length === 0 ? <p>None</p> : snapshot.medications.map((medicine, index) => <p key={index}>{index + 1}. {MEDICATION_FIELDS.map(({ key, label }) => `${label}: ${medicine[key] || '—'}`).join(' · ')}</p>)}</div>}</>}
    </div></details>
    <div className="consultation-recovery-actions">{canRestore && <button type="button" className="workflow-action" onClick={onRestore}>Restore local edits to form</button>}<button type="button" className="workflow-link" onClick={onDiscard}>Discard local copy</button></div>
    {!canRestore && <p className="workflow-hint">Restore is available only after the server confirms this encounter is still an editable draft.</p>}
  </section>;
}

function clinicTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value));
}

function ConsultationDesk({ clinicSlug, csrfToken, role, onSessionLost, onDirtyChange, onPendingChange }: Props) {
  const doctorRole = role === 'doctor';
  const [date, setDate] = useState(pilotDateToday);
  const [queue, setQueue] = useState<ConsultationQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [queueReload, setQueueReload] = useState(0);
  const [selected, setSelected] = useState<ConsultationQueueItem | null>(null);
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [readLoading, setReadLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [visitError, setVisitError] = useState('');
  const [readReload, setReadReload] = useState(0);
  const [accessDenied, setAccessDenied] = useState(false);
  const [vitalForm, setVitalForm] = useState<VitalForm>(() => vitalFormFrom(null));
  const [vitalBaseline, setVitalBaseline] = useState<VitalForm>(() => vitalFormFrom(null));
  const [note, setNote] = useState<ConsultationNote>(emptyNote);
  const [noteBaseline, setNoteBaseline] = useState<ConsultationNote>(emptyNote);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [medicationBaseline, setMedicationBaseline] = useState<Medication[]>([]);
  const [pending, setPending] = useState<'vitals' | 'draft' | 'finalize' | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [recoverySnapshot, setRecoverySnapshot] = useState<RecoverySnapshot | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const readErrorRef = useRef<HTMLHeadingElement>(null);

  const vitalDirty = !!encounter && JSON.stringify(vitalForm) !== JSON.stringify(vitalBaseline);
  const noteDirty = !!encounter && doctorRole && (JSON.stringify(note) !== JSON.stringify(noteBaseline) ||
    JSON.stringify(medications) !== JSON.stringify(medicationBaseline));
  const dirty = vitalDirty || noteDirty;
  const navigationRisk = dirty || needsReload || recoverySnapshot !== null;

  useEffect(() => { onDirtyChange?.(navigationRisk); }, [navigationRisk, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => { onPendingChange?.(pending !== null); }, [pending, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  useEffect(() => { if (confirmFinal) confirmButtonRef.current?.focus(); }, [confirmFinal]);
  useEffect(() => { if (readError) readErrorRef.current?.focus(); }, [readError]);
  useEffect(() => {
    if (!navigationRisk && !pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [navigationRisk, pending]);

  function handleAccessError(error: unknown, scope: 'module' | 'visit'): boolean {
    if (!(error instanceof ConsultationApiError)) return false;
    if (error.status === 401) { onSessionLost(); return true; }
    if (error.status === 403) {
      if (scope === 'module') {
        setAccessDenied(true); setQueue([]);
      } else {
        setVisitError('Access to that visit changed. Select another available visit.');
        setQueueReload((value) => value + 1);
      }
      setSelected(null); setEncounter(null); setRecoverySnapshot(null);
      const blankVitals = vitalFormFrom(null);
      const blankNote = emptyNote();
      setVitalForm(blankVitals); setVitalBaseline(blankVitals);
      setNote(blankNote); setNoteBaseline(blankNote);
      setMedications([]); setMedicationBaseline([]);
      setNeedsReload(false); setActionError(''); setActionSuccess(''); setConfirmFinal(false);
      return true;
    }
    return false;
  }
  function safeToDiscard(): boolean {
    if (needsReload) return window.confirm('The last save or finalization is unverified. Leave this encounter before checking the server result?');
    if (recoverySnapshot) return window.confirm('Discard the local recovery copy and leave this encounter?');
    return !dirty || window.confirm('Discard unsaved consultation changes?');
  }
  function choose(item: ConsultationQueueItem) {
    if (selected?.appointmentId === item.appointmentId && selected.clinicDate === item.clinicDate) return;
    if (pending || !safeToDiscard()) return;
    setActionError(''); setActionSuccess(''); setNeedsReload(false); setConfirmFinal(false); setRecoverySnapshot(null); setVisitError('');
    setSelected(item); setEncounter(null);
  }
  function chooseDate(next: string) {
    if (next === date) return;
    if (pending || !safeToDiscard()) return;
    setSelected(null); setEncounter(null); setActionError(''); setActionSuccess('');
    setNeedsReload(false); setConfirmFinal(false); setRecoverySnapshot(null); setVisitError(''); setDate(next);
  }
  function resetForms(value: Encounter) {
    const vitals = vitalFormFrom(value.vitals);
    setVitalForm(vitals); setVitalBaseline(vitals);
    const nextNote = value.note ?? emptyNote();
    setNote(nextNote); setNoteBaseline(nextNote);
    const nextMedications = value.medications ?? [];
    setMedications(nextMedications); setMedicationBaseline(nextMedications);
  }
  function matchesSelection(value: Encounter, item: ConsultationQueueItem): boolean {
    return value.appointmentId === item.appointmentId && value.clinicDate === item.clinicDate &&
      value.patient.id === item.patientId && value.doctor.id === item.doctorId &&
      value.clinic.slug === clinicSlug && (!doctorRole || (value.note !== undefined && value.medications !== undefined));
  }

  useEffect(() => {
    const controller = new AbortController();
    setQueue([]); setQueueLoading(true); setQueueError('');
    void getConsultationQueue(clinicSlug, date, controller.signal).then((items) => {
      if (!controller.signal.aborted) setQueue(items);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !handleAccessError(error, 'module')) setQueueError('Consultation queue unavailable. Retry before selecting a visit.');
    }).finally(() => { if (!controller.signal.aborted) setQueueLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, date, queueReload]);

  useEffect(() => {
    if (!selected) return;
    const item = selected;
    const controller = new AbortController();
    setEncounter(null); setReadLoading(true); setReadError(''); setActionError(''); setConfirmFinal(false);
    void readEncounter(clinicSlug, item.appointmentId, item.clinicDate, csrfToken, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (!matchesSelection(value, item)) {
        setReadError('Visit identity could not be verified. Select the visit again.');
        return;
      }
      setEncounter(value); resetForms(value); setNeedsReload(false);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !handleAccessError(error, 'visit')) setReadError('Could not load this encounter. Retry before editing.');
    }).finally(() => { if (!controller.signal.aborted) setReadLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, csrfToken, selected?.appointmentId, selected?.clinicDate, readReload]);

  function writeError(error: unknown, kind: 'vitals' | 'draft' | 'finalize') {
    if (handleAccessError(error, 'visit')) return;
    if (error instanceof ConsultationApiError && error.status === 400) {
      setActionError(error.message === 'Draft is too long'
        ? 'The draft is too long to save. Shorten notes or medicine instructions and try again.'
        : 'The server rejected these details. Review the fields and try again.');
      return;
    }
    setNeedsReload(true);
    setConfirmFinal(false);
    setActionError(error instanceof ConsultationApiError && error.status === 409
      ? 'This encounter changed or was finalized elsewhere. Your edits remain on screen. Reload the server record before another save.'
      : `Could not confirm whether ${kind === 'finalize' ? 'finalization' : 'the save'} succeeded. Reload the server record before trying again.`);
  }
  function reloadEncounter() {
    if (pending || !selected) return;
    if (dirty) setRecoverySnapshot(snapshotEdits(vitalForm, vitalBaseline, note, noteBaseline, medications, medicationBaseline));
    setActionError(''); setActionSuccess(''); setReadReload((value) => value + 1);
  }

  function restoreLocalEdits() {
    if (!recoverySnapshot || !encounter || encounter.status === 'finalized') return;
    if ((Object.keys(recoverySnapshot.vitalChanges).length > 0 || recoverySnapshot.medications !== null) &&
        !window.confirm('Restore your changed fields over the reloaded values? Check all measurements and their observation time, and compare the medicine list before saving.')) return;
    const restored = mergeRecoveredFields(recoverySnapshot, vitalForm, note);
    setVitalForm(restored.vitals);
    if (doctorRole) {
      setNote(restored.note);
      if (recoverySnapshot.medications !== null) setMedications(recoverySnapshot.medications);
    }
    setRecoverySnapshot(null);
    setActionSuccess('Local edits restored in this browser. Review the server record before saving again.');
  }

  async function handleVitals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !encounter || pending || encounter.status === 'finalized' || needsReload) return;
    const input = parseVitalForm(vitalForm);
    if (!input) { setActionError('Check the observation time and measurement ranges. Enter at least one value, with both blood pressure values together.'); return; }
    setPending('vitals'); setActionError(''); setActionSuccess(''); setConfirmFinal(false);
    try {
      const saved = await saveVitals(clinicSlug, selected.appointmentId, selected.clinicDate, encounter.revision, input, csrfToken);
      if (!matchesSelection(saved, selected)) throw new ConsultationApiError(null, 'Visit identity mismatch');
      setEncounter(saved);
      const next = vitalFormFrom(saved.vitals);
      setVitalForm(next); setVitalBaseline(next);
      setActionSuccess('Vitals saved to the encounter.');
      setQueueReload((value) => value + 1);
    } catch (error) { writeError(error, 'vitals'); }
    finally { setPending(null); }
  }

  async function handleDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!doctorRole || !selected || !encounter || pending || encounter.status === 'finalized' || needsReload) return;
    if (medications.length > 20) { setActionError('Use at most 20 doctor-entered medication entries.'); return; }
    if (medications.some((medication) => !medication.name.trim())) { setActionError('Enter a name for each medicine or remove its empty row.'); return; }
    setPending('draft'); setActionError(''); setActionSuccess(''); setConfirmFinal(false);
    try {
      const saved = await saveDraft(clinicSlug, selected.appointmentId, selected.clinicDate, encounter.revision, note, medications, csrfToken);
      if (!matchesSelection(saved, selected)) throw new ConsultationApiError(null, 'Visit identity mismatch');
      setEncounter(saved);
      const nextNote = saved.note ?? emptyNote();
      const nextMedications = saved.medications ?? [];
      setNote(nextNote); setNoteBaseline(nextNote);
      setMedications(nextMedications); setMedicationBaseline(nextMedications);
      setActionSuccess('Consultation draft saved. It is not finalized.');
      setQueueReload((value) => value + 1);
    } catch (error) { writeError(error, 'draft'); }
    finally { setPending(null); }
  }

  async function handleFinalize() {
    if (!doctorRole || !selected || !encounter || !confirmFinal || pending || needsReload || dirty ||
        encounter.status !== 'draft' || encounter.revision < 1 || !completeForFinalize(note, medications)) return;
    setPending('finalize'); setActionError(''); setActionSuccess('');
    try {
      const finalized = await finalizeEncounter(clinicSlug, selected.appointmentId, selected.clinicDate, encounter.revision, csrfToken);
      if (!matchesSelection(finalized, selected) || finalized.status !== 'finalized') throw new ConsultationApiError(null, 'Finalization not confirmed');
      setEncounter(finalized); resetForms(finalized); setConfirmFinal(false);
      setActionSuccess('Encounter finalized by the server. It is now read-only.');
      setQueueReload((value) => value + 1);
    } catch (error) { writeError(error, 'finalize'); }
    finally { setPending(null); }
  }

  const printable = doctorRole && encounter?.status === 'finalized' ? encounter.printablePrescription : undefined;

  if (accessDenied) return <section className="workflow-access" role="alert"><h3>Consultation access unavailable</h3><p>This clinic, role, or doctor assignment does not allow consultation access. Contact your clinic administrator.</p></section>;

  return <div className="consultation">
    <div className="workflow-intro"><div><span className="eyebrow">CLINICAL WORKSPACE</span><h3>Consultations</h3><p>{doctorRole ? 'Review your assigned visits, record care, and finalize your own draft.' : 'Record observed vitals for an existing clinic visit.'}</p></div><span className="workflow-pilot">Synthetic pilot only</span></div>
    <p className="workflow-notice">Clinicians enter all findings and medicines. This workspace does not make clinical decisions or check medicine safety. Do not enter real patient data in staging.</p>
    <div className="consultation-layout">
      <section className="workflow-card consultation-list" aria-labelledby="consultation-queue-heading">
        <div className="workflow-card-head"><div><span className="workflow-step">01</span><h4 id="consultation-queue-heading">{doctorRole ? 'My visits' : 'Clinic visits'}</h4></div><p>Choose a recorded appointment to open its encounter.</p></div>
        <div className="consultation-queue-controls"><label>Clinic date<input type="date" value={date} onChange={(event) => chooseDate(event.target.value)} /></label><button type="button" className="workflow-link" disabled={queueLoading} onClick={() => setQueueReload((value) => value + 1)}>Refresh list</button></div>
        {visitError && <p className="workflow-error" role="alert">{visitError}</p>}
        {queueLoading ? <p className="workflow-muted" role="status">Loading visits…</p> : queueError ? <p className="workflow-error" role="alert">{queueError}</p> : queue.length === 0 ? <p className="workflow-empty" role="status">No visits found for this date.</p> : <div className="consultation-visit-list">{queue.map((item) => <button type="button" key={item.appointmentId} className={`consultation-visit${selected?.appointmentId === item.appointmentId ? ' is-selected' : ''}`} onClick={() => choose(item)} aria-pressed={selected?.appointmentId === item.appointmentId}><span className="consultation-visit-top"><strong>{item.patientName}</strong><span>{item.encounterStatus === 'finalized' ? 'Finalized' : 'Not started / draft'}</span></span><span>{item.doctorName}</span><span>{clinicTime(item.startAt)} · {item.appointmentStatus.replaceAll('_', ' ')}</span></button>)}</div>}
      </section>

      <div className="consultation-main">
        {!selected ? <section className="workflow-card consultation-empty" role="status"><span className="workflow-step">02</span><h4>Select a visit</h4><p>Choose an existing appointment from the list to view or record its encounter.</p></section> : readLoading ? <section className="workflow-card consultation-empty" role="status"><h4>Loading encounter…</h4><p>Checking visit and staff access.</p></section> : readError || !encounter ? <><section className="workflow-card consultation-empty" role="alert"><h4 ref={readErrorRef} tabIndex={-1}>Encounter unavailable</h4><p>{readError || 'The encounter could not be verified.'}</p><button type="button" className="workflow-link" onClick={reloadEncounter}>Retry encounter</button></section>{recoverySnapshot && <RecoveryCopy snapshot={recoverySnapshot} doctorRole={doctorRole} canRestore={false} onRestore={restoreLocalEdits} onDiscard={() => setRecoverySnapshot(null)} />}</> : <>
          <section className="workflow-card consultation-identity" aria-labelledby="encounter-heading"><div className="consultation-identity-top"><div><span className="eyebrow">VISIT RECORD</span><h4 id="encounter-heading">{encounter.patient.fullName}</h4><p>{encounter.patient.ageYears} years at registration · {encounter.patient.sex} · {encounter.doctor.displayName}</p></div><span className={`consultation-status${encounter.status === 'finalized' ? ' is-final' : ''}`}>{encounter.status === 'finalized' ? 'Finalized' : encounter.revision === 0 ? 'Not started' : 'Draft'}</span></div><p className="consultation-meta">Appointment: {clinicTime(selected.startAt)} · Clinic date: {selected.clinicDate} · {encounter.clinic.displayName}</p>{encounter.status === 'finalized' && encounter.finalizedAt && <p className="consultation-meta">Finalized: {clinicTime(encounter.finalizedAt)}</p>}</section>

          {actionError && <div className="workflow-error consultation-feedback" role="alert"><p>{actionError}</p>{needsReload && <button type="button" className="workflow-link" onClick={reloadEncounter}>Reload server record</button>}</div>}
          {actionSuccess && <p className="workflow-success consultation-feedback" role="status">{actionSuccess}</p>}
          {recoverySnapshot && <RecoveryCopy snapshot={recoverySnapshot} doctorRole={doctorRole} canRestore={encounter.status === 'draft'} onRestore={restoreLocalEdits} onDiscard={() => setRecoverySnapshot(null)} />}

          <section className="workflow-card consultation-section" aria-labelledby="vitals-heading"><div className="workflow-card-head"><div><span className="workflow-step">02</span><h4 id="vitals-heading">Observed vitals</h4></div><p>Enter measured values with units and the time they were observed.</p></div>
            {encounter.vitals && <p className="consultation-recorded">Last recorded by {encounter.vitals.recordedByDisplayName} at {clinicTime(encounter.vitals.recordedAt)} · observed {clinicTime(encounter.vitals.observedAt)}</p>}
            {encounter.status === 'finalized' ? <div className="consultation-vital-grid">{encounter.vitals ? VITAL_FIELDS.filter(({ key }) => encounter.vitals?.[key] !== undefined).map(({ key, label, unit }) => <div className="consultation-vital-read" key={key}><span>{label}</span><strong>{encounter.vitals?.[key]} {unit}</strong></div>) : <p className="workflow-empty">No vitals recorded.</p>}</div> : <form onSubmit={handleVitals} aria-busy={pending === 'vitals'}><div className="consultation-vital-grid"><label className="consultation-observed">Observed at · Asia/Kolkata<input type="datetime-local" value={vitalForm.observedAt} onChange={(event) => setVitalForm({ ...vitalForm, observedAt: event.target.value })} required disabled={!!pending || needsReload} /></label>{VITAL_FIELDS.map(({ key, label, unit }) => <label key={key}>{label} <span className="workflow-optional">{unit}</span><input type="number" min={key === 'spo2Percent' || key === 'temperatureC' || key === 'weightKg' || key === 'heightCm' ? '0' : '1'} max={key === 'systolicBpMmHg' ? '400' : key === 'diastolicBpMmHg' ? '300' : key === 'pulseBpm' ? '350' : key === 'spo2Percent' ? '100' : key === 'temperatureC' ? '50' : key === 'weightKg' ? '500' : '300'} step="any" inputMode="decimal" value={vitalForm[key]} onChange={(event) => setVitalForm({ ...vitalForm, [key]: event.target.value })} disabled={!!pending || needsReload} /></label>)}</div><button className="workflow-action consultation-save" type="submit" disabled={!!pending || needsReload || !vitalDirty}>Save measured vitals</button></form>}
          </section>

          {doctorRole && encounter.note && encounter.medications && <section className="workflow-card consultation-section" aria-labelledby="note-heading"><div className="workflow-card-head"><div><span className="workflow-step">03</span><h4 id="note-heading">Doctor consultation</h4></div><p>Clinical text and prescription entries are written by the assigned doctor.</p></div>
            {encounter.status === 'finalized' ? <div className="consultation-readonly">{NOTE_FIELDS.map(({ key, label }) => <div key={key}><strong>{label}</strong><p>{encounter.note?.[key] || 'Not recorded'}</p></div>)}<h5>Prescription entries</h5>{encounter.medications.length === 0 ? <p>No medicines recorded.</p> : encounter.medications.map((medicine, index) => <div className="consultation-med-read" key={index}><strong>{index + 1}. {medicine.name} {medicine.strength}</strong><p>{medicine.dose} · {medicine.route} · {medicine.frequency} · {medicine.duration}</p><p>{medicine.instructions}</p></div>)}</div> : <form onSubmit={handleDraft} aria-busy={pending === 'draft'}>
              <div className="consultation-note-fields">{NOTE_FIELDS.map(({ key, label }) => <label key={key}>{label}{(key === 'assessment' || key === 'plan') && <span className="workflow-optional"> required before finalizing</span>}<textarea rows={key === 'history' || key === 'exam' ? 3 : 2} maxLength={3000} value={note[key]} onChange={(event) => setNote({ ...note, [key]: event.target.value })} disabled={!!pending || needsReload} /></label>)}</div>
              <div className="consultation-meds-head"><h5>Doctor-entered prescription items</h5><button type="button" className="workflow-link" disabled={!!pending || needsReload || medications.length >= 20} onClick={() => setMedications([...medications, emptyMedication()])}>Add medicine</button></div>
              {medications.length === 0 && <p className="workflow-empty">No medicine entries. A consultation may be finalized without a prescription.</p>}
              {medications.map((medicine, index) => <fieldset className="consultation-med" key={index}><legend>Medicine {index + 1}</legend><div className="consultation-med-fields">{MEDICATION_FIELDS.map(({ key, label }) => <label key={key}>{label}{key === 'strength' && <span className="workflow-optional"> optional</span>}<input type="text" maxLength={key === 'instructions' ? 500 : 160} required={key === 'name'} value={medicine[key]} onChange={(event) => setMedications(medications.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value } : item))} disabled={!!pending || needsReload} /></label>)}</div><button type="button" className="workflow-link" disabled={!!pending || needsReload} onClick={() => setMedications(medications.filter((_, itemIndex) => itemIndex !== index))}>Remove medicine {index + 1}</button></fieldset>)}
              <button className="workflow-action consultation-save" type="submit" disabled={!!pending || needsReload || !noteDirty}>Save consultation draft</button>
            </form>}
          </section>}

          {doctorRole && encounter.status === 'draft' && encounter.note && <section className="workflow-card consultation-section consultation-finalize" aria-labelledby="finalize-heading"><div className="workflow-card-head"><div><span className="workflow-step">04</span><h4 id="finalize-heading">Finalize encounter</h4></div><p>Finalization is read-only afterward in this pilot. Review the saved draft first.</p></div>
            {encounter.revision === 0 ? <p className="workflow-hint">Save a draft before finalizing.</p> : dirty ? <p className="workflow-hint">Save or discard unsaved changes before finalizing.</p> : !completeForFinalize(note, medications) ? <p className="workflow-hint">Assessment and plan are required. Each medicine needs a name, dose, route, frequency, duration, and instructions.</p> : !confirmFinal ? <button type="button" className="workflow-link consultation-finalize-start" onClick={() => setConfirmFinal(true)} disabled={!!pending || needsReload}>Review finalization</button> : <div className="consultation-confirm" role="group" aria-label="Confirm encounter finalization"><p>Finalize this saved draft for {encounter.patient.fullName}? You cannot edit it in this pilot. The server will confirm the final status.</p><div><button type="button" className="workflow-link" onClick={() => setConfirmFinal(false)}>Cancel</button><button ref={confirmButtonRef} type="button" className="workflow-action" onClick={handleFinalize} disabled={!!pending || needsReload}>{pending === 'finalize' ? 'Finalizing…' : 'Confirm finalization'}</button></div></div>}
          </section>}

          {printable && <section className="workflow-card consultation-section consultation-print-action"><div><h4>Finalized prescription</h4><p>Print the server-confirmed prescription for this synthetic pilot.</p></div><button type="button" className="workflow-action" onClick={() => window.print()}>Print prescription</button></section>}
        </>}
      </div>
    </div>

    {printable && <section className="prescription-print" aria-label="Finalized prescription print view"><div className="print-pilot">ClinicPluz synthetic pilot · Not for real clinical use</div><header><h1>{printable.clinic.displayName}</h1><p>Finalized prescription · {printable.appointmentDate}</p></header><div className="print-people"><p><strong>Patient:</strong> {printable.patient.fullName} · {printable.patient.ageYears} years at registration · {printable.patient.sex}</p><p><strong>Doctor:</strong> {printable.doctor.displayName}</p><p><strong>Finalized:</strong> {clinicTime(printable.finalizedAt)}</p></div><h2>Doctor-entered medicines</h2><ol>{printable.medications.map((medicine, index) => <li key={index}><strong>{medicine.name} {medicine.strength}</strong><p>Dose: {medicine.dose} · Route: {medicine.route}</p><p>Frequency: {medicine.frequency} · Duration: {medicine.duration}</p><p>Instructions: {medicine.instructions}</p></li>)}</ol><footer>Generated from the finalized ClinicPluz encounter. No automated clinical checks or advice are provided.</footer></section>}
  </div>;
}

export default function Consultation(props: Props) {
  if (props.role !== 'nurse' && props.role !== 'doctor') return <section className="workflow-access" role="status"><h3>No consultation access</h3><p>Only authorized nurses and assigned doctors can open this pilot consultation module.</p></section>;
  return <ConsultationDesk {...props} />;
}
