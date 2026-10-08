import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClinicRole } from './api';
import {
  createAppointment, getAppointments, getDoctors, pilotDateToday, pilotSlotToIso,
  registerPatient, searchPatients, WorkflowApiError,
  type Appointment, type BookingSource, type Doctor, type Patient, type PatientSex,
} from './workflowApi';

interface Props {
  clinicSlug: string;
  csrfToken: string;
  role: ClinicRole;
  onSessionLost: () => void;
}

const CAN_BOOK = new Set<ClinicRole>(['clinic_admin', 'receptionist', 'nurse']);
const CAN_READ = CAN_BOOK;
const PILOT_SLOTS = Array.from({ length: 18 }, (_, index) => {
  const minutes = 9 * 60 + 30 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});
const SEX_LABELS: Record<PatientSex, string> = { female: 'Female', male: 'Male', other: 'Other', undisclosed: 'Prefer not to say' };

function timeLabel(startAt: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(startAt));
}

function errorMessage(error: unknown, action: 'load' | 'search' | 'register' | 'book'): string {
  if (error instanceof WorkflowApiError) {
    if (error.status === 400) return 'Please check the details and try again.';
    if (error.status === 429) return 'Too many requests. Wait a moment and try again.';
    if (error.status === 503) return 'The clinic service is temporarily unavailable. Try again shortly.';
  }
  if (action === 'book') return 'Could not confirm whether the booking was saved. Check the queue before trying again.';
  if (action === 'register') return 'Could not confirm whether the patient was saved. Search before trying again.';
  return 'The clinic workflow could not be loaded. Please retry.';
}

function WorkflowDesk({ clinicSlug, csrfToken, role, onSessionLost }: Props) {
  const canBook = CAN_BOOK.has(role);
  const [accessDenied, setAccessDenied] = useState(false);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [doctorsError, setDoctorsError] = useState('');
  const [doctorReload, setDoctorReload] = useState(0);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [date, setDate] = useState(pilotDateToday);
  const [queue, setQueue] = useState<Appointment[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [queueReload, setQueueReload] = useState(0);
  const [mode, setMode] = useState<'search' | 'register'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [ageYears, setAgeYears] = useState('');
  const [sex, setSex] = useState<PatientSex | ''>('');
  const [email, setEmail] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [time, setTime] = useState('');
  const [source, setSource] = useState<BookingSource | ''>('');
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [bookingSuccess, setBookingSuccess] = useState('');

  useEffect(() => () => searchController.current?.abort(), []);

  function handleAccessError(error: unknown): boolean {
    if (!(error instanceof WorkflowApiError)) return false;
    if (error.status === 401) { onSessionLost(); return true; }
    if (error.status === 403) {
      setAccessDenied(true);
      setDoctors([]);
      setQueue([]);
      setResults([]);
      setSelectedPatient(null);
      return true;
    }
    return false;
  }

  useEffect(() => {
    const controller = new AbortController();
    setDoctorsLoading(true);
    setDoctorsError('');
    void getDoctors(clinicSlug, controller.signal).then((items) => {
      if (!controller.signal.aborted) setDoctors(items);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !handleAccessError(error)) setDoctorsError(errorMessage(error, 'load'));
    }).finally(() => { if (!controller.signal.aborted) setDoctorsLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, doctorReload]);

  useEffect(() => {
    const controller = new AbortController();
    setQueue([]);
    setQueueLoading(true);
    setQueueError('');
    void getAppointments(clinicSlug, date, controller.signal).then((items) => {
      if (!controller.signal.aborted) setQueue(items);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !handleAccessError(error)) setQueueError(errorMessage(error, 'load'));
    }).finally(() => { if (!controller.signal.aborted) setQueueLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, date, queueReload]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length < 2 || searchLoading) return;
    setResults([]);
    setSelectedPatient(null);
    setSearched(false);
    setSearchError('');
    setSearchLoading(true);
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    try {
      const found = await searchPatients(clinicSlug, query, csrfToken, controller.signal);
      if (!controller.signal.aborted) { setResults(found); setSearched(true); }
    } catch (error) {
      if (!controller.signal.aborted && !handleAccessError(error)) setSearchError(errorMessage(error, 'search'));
    } finally { if (!controller.signal.aborted) setSearchLoading(false); }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canBook || registering) return;
    const age = Number(ageYears);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      setRegisterError('Enter an age in whole years between 0 and 120.');
      return;
    }
    if (!sex) { setRegisterError('Select a sex value, including “Prefer not to say” if appropriate.'); return; }
    setRegistering(true);
    setRegisterError('');
    try {
      const patient = await registerPatient(clinicSlug, {
        fullName: fullName.trim(), phone: phone.trim(), ageYears: age, sex,
        ...(email.trim() ? { email: email.trim() } : {}),
      }, csrfToken);
      setSelectedPatient(patient);
      setMode('search');
      setQuery('');
      setResults([]);
      setSearched(false);
      setFullName(''); setPhone(''); setAgeYears(''); setSex(''); setEmail('');
    } catch (error) {
      if (!handleAccessError(error)) setRegisterError(errorMessage(error, 'register'));
    } finally { setRegistering(false); }
  }

  async function handleBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canBook || !selectedPatient || !source || booking || queueLoading || queueError || doctorsLoading || doctorsError) return;
    const startAt = pilotSlotToIso(date, time);
    if (!startAt) { setBookingError('Choose a valid 30-minute slot in the provisional clinic schedule.'); return; }
    setBooking(true);
    setBookingError('');
    setBookingSuccess('');
    try {
      const appointment = await createAppointment(clinicSlug, {
        patientId: selectedPatient.id, doctorId: selectedDoctorId, startAt, source,
      }, csrfToken);
      setBookingSuccess(`${source === 'walk_in' ? 'Walk-in checked in' : 'Phone appointment booked'} for ${selectedPatient.fullName} at ${timeLabel(startAt)}. Server status: ${appointment.status}.`);
      setTime('');
      setQueueReload((value) => value + 1);
    } catch (error) {
      if (!handleAccessError(error)) {
        if (error instanceof WorkflowApiError && error.status === 409) {
          setBookingError('This doctor’s slot was just taken. Choose another 30-minute slot.');
          setQueueReload((value) => value + 1);
        } else {
          setBookingError(errorMessage(error, 'book'));
        }
      }
    } finally { setBooking(false); }
  }

  if (accessDenied) return <section className="workflow-access" role="alert"><h3>Workflow access unavailable</h3><p>Your role or this clinic’s enabled modules do not allow this workflow. Contact your clinic administrator.</p></section>;

  return (
    <div className="workflow">
      <div className="workflow-intro"><div><span className="eyebrow">DAILY CLINIC FLOW</span><h3>Patients and appointments</h3><p>Register or find a patient, then coordinate a 30-minute visit with a doctor.</p></div><span className="workflow-pilot">Synthetic pilot only</span></div>
      <p className="workflow-notice">Provisional pilot hours: 09:30–18:30, Asia/Kolkata. Last start 18:00. This schedule will become clinic-configurable; do not use real patient data yet.</p>

      <div className="workflow-grid">
        <section className="workflow-card" aria-labelledby="patient-heading">
          <div className="workflow-card-head"><div><span className="workflow-step">01</span><h4 id="patient-heading">Find a patient</h4></div><p>Staff enter details for both phone bookings and walk-ins.</p></div>
          {canBook && <div className="workflow-switch" role="group" aria-label="Patient action"><button type="button" className={mode === 'search' ? 'is-active' : ''} onClick={() => { setMode('search'); setRegisterError(''); }}>Search existing</button><button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => { searchController.current?.abort(); setMode('register'); setSelectedPatient(null); setSearchError(''); }}>Register new</button></div>}
          {mode === 'search' || !canBook ? <>
            <form className="workflow-form workflow-search" onSubmit={handleSearch}>
              <label htmlFor="patient-query">Patient name or phone</label>
              <div className="workflow-inline"><input id="patient-query" type="search" autoComplete="off" value={query} onChange={(event) => { searchController.current?.abort(); setSearchLoading(false); setQuery(event.target.value); setResults([]); setSearched(false); setSelectedPatient(null); }} placeholder="Enter at least 2 characters" minLength={2} required /><button type="submit" disabled={searchLoading || query.trim().length < 2}>{searchLoading ? 'Searching…' : 'Search'}</button></div>
            </form>
            {searchError && <p className="workflow-error" role="alert">{searchError}</p>}
            {searched && results.length === 0 && <p className="workflow-empty" role="status">No matching patients found. {canBook ? 'Register a new patient if needed.' : ''}</p>}
            {results.length > 0 && <div className="patient-results" role="region" aria-label="Patient search results">{results.map((patient) => <div className="patient-result" key={patient.id}><div><strong>{patient.fullName}</strong><span>{patient.phone} · {patient.ageYears} years at registration · {SEX_LABELS[patient.sex]}</span></div>{canBook && <button type="button" aria-label={`Select ${patient.fullName}`} onClick={() => setSelectedPatient(patient)} disabled={selectedPatient?.id === patient.id}>{selectedPatient?.id === patient.id ? 'Selected' : 'Select'}</button>}</div>)}</div>}
            {selectedPatient && canBook && <p className="workflow-selected" role="status">Selected patient: <strong>{selectedPatient.fullName}</strong></p>}
          </> : <form className="workflow-form workflow-register" onSubmit={handleRegister} aria-busy={registering}>
            <div className="workflow-fields"><label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="off" maxLength={120} required disabled={registering} /></label><label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="off" maxLength={25} required disabled={registering} /></label><label>Age in years<input type="number" min="0" max="120" step="1" value={ageYears} onChange={(event) => setAgeYears(event.target.value)} required disabled={registering} /></label><label>Sex<select value={sex} onChange={(event) => setSex(event.target.value as PatientSex | '')} required disabled={registering}><option value="" disabled>Choose one</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="undisclosed">Prefer not to say</option></select></label><label className="workflow-span">Email <span className="workflow-optional">optional</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" maxLength={254} disabled={registering} /></label></div>
            {registerError && <p className="workflow-error" role="alert">{registerError}</p>}
            <button className="workflow-action" type="submit" disabled={registering}>{registering ? 'Saving patient…' : 'Register and select patient'}</button>
          </form>}
        </section>

        <section className="workflow-card" aria-labelledby="booking-heading">
          <div className="workflow-card-head"><div><span className="workflow-step">02</span><h4 id="booking-heading">{canBook ? 'Book a visit' : 'Doctor roster'}</h4></div><p>{canBook ? 'Choose a doctor and request a slot. The server confirms conflicts.' : 'View doctors and the date queue.'}</p></div>
          {doctorsLoading ? <p className="workflow-muted" role="status">Loading doctors…</p> : doctorsError ? <div role="alert"><p className="workflow-error">{doctorsError}</p><button className="workflow-link" type="button" onClick={() => setDoctorReload((value) => value + 1)}>Retry doctor list</button></div> : doctors.length === 0 ? <p className="workflow-empty">No doctors are configured for this clinic.</p> : canBook ? <form className="workflow-form workflow-book" onSubmit={handleBooking} aria-busy={booking}>
            <label>Doctor<select value={selectedDoctorId} onChange={(event) => setSelectedDoctorId(event.target.value)} required disabled={booking}><option value="">Choose a doctor</option>{doctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.displayName}</option>)}</select></label>
            <label>Visit date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setBookingError(''); setBookingSuccess(''); }} required disabled={booking} /></label>
            <label>30-minute start time<select value={time} onChange={(event) => { setTime(event.target.value); setBookingError(''); }} required disabled={booking}><option value="">Choose a time</option>{PILOT_SLOTS.map((slot) => <option value={slot} key={slot}>{slot}</option>)}</select></label>
            <fieldset className="workflow-source"><legend>How did the patient arrive?</legend><label><input type="radio" name="source" value="phone" checked={source === 'phone'} onChange={() => setSource('phone')} required disabled={booking} /> Phone booking</label><label><input type="radio" name="source" value="walk_in" checked={source === 'walk_in'} onChange={() => setSource('walk_in')} required disabled={booking} /> Walk-in check-in</label></fieldset>
            <p className="workflow-hint">Showing requested times, not guaranteed availability. The clinic service prevents double-booking.</p>
            {bookingError && <p className="workflow-error" role="alert">{bookingError}</p>}
            {bookingSuccess && <p className="workflow-success" role="status">{bookingSuccess}</p>}
            <button className="workflow-action" type="submit" disabled={!selectedPatient || !selectedDoctorId || !time || !source || booking || queueLoading || !!queueError}>{booking ? 'Saving visit…' : source === 'walk_in' ? 'Check in walk-in' : 'Book phone appointment'}</button>
            {!selectedPatient && <p className="workflow-hint">Select or register a patient first.</p>}
            {queueError && <p className="workflow-hint">Reload the queue before booking.</p>}
          </form> : <ul className="workflow-doctors">{doctors.map((doctor) => <li key={doctor.id}>{doctor.displayName}</li>)}</ul>}
        </section>
      </div>

      <section className="workflow-card workflow-queue" aria-labelledby="queue-heading"><div className="workflow-card-head workflow-queue-head"><div><span className="workflow-step">03</span><h4 id="queue-heading">Date queue</h4><p>Bookings and walk-ins recorded for this clinic day.</p></div><div className="workflow-queue-controls"><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button className="workflow-link" type="button" onClick={() => setQueueReload((value) => value + 1)} disabled={queueLoading}>Refresh queue</button></div></div>
        {queueLoading ? <p className="workflow-muted" role="status">Loading queue…</p> : queueError ? <p className="workflow-error" role="alert">{queueError}</p> : queue.length === 0 ? <p className="workflow-empty" role="status">No visits on {date}. Bookings and walk-ins will appear here.</p> : <div className="workflow-table-wrap"><table className="workflow-table"><caption>Appointments for {date}, Asia/Kolkata</caption><thead><tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col">Doctor</th><th scope="col">Source</th><th scope="col">Status</th></tr></thead><tbody>{queue.map((visit) => <tr key={visit.id}><td>{timeLabel(visit.startAt)}</td><td>{visit.patientName}</td><td>{visit.doctorName}</td><td>{visit.source === 'walk_in' ? 'Walk-in' : 'Phone'}</td><td><span className="workflow-status">{visit.status.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}

export default function Workflow(props: Props) {
  if (!CAN_READ.has(props.role)) return <section className="workflow-access" role="status"><h3>No clinic workflow access</h3><p>Patient intake and appointments are available to authorized clinic staff. Contact your clinic administrator if you need access.</p></section>;
  return <WorkflowDesk {...props} />;
}
