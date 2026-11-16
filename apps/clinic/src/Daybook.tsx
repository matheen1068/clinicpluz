import { useEffect, useMemo, useState } from 'react';
import { formatPaise } from './billingMoney';
import { DaybookApiError, daybookCsv, getDaybook, shiftDay, summarize, validRange, type Daybook as DaybookData } from './daybook';
import { pilotDateToday } from './workflowApi';

interface Props { clinicSlug: string; clinicName: string; role: 'doctor' | 'receptionist' | 'clinic_admin'; onSessionLost: () => void }
type Preset = 'today' | '7' | '30' | 'custom';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: 'custom', label: 'Custom' },
];
function dayLabel(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00Z`));
}
function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
}

export default function Daybook({ clinicSlug, clinicName, role, onSessionLost }: Props) {
  const today = pilotDateToday();
  const [preset, setPreset] = useState<Preset>('today');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<DaybookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [reload, setReload] = useState(0);
  const [doctorId, setDoctorId] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const rangeOk = validRange(from, to);

  function choosePreset(next: Preset) {
    setPreset(next);
    if (next === 'today') { setFrom(today); setTo(today); }
    else if (next === '7') { setFrom(shiftDay(today, -6)); setTo(today); }
    else if (next === '30') { setFrom(shiftDay(today, -29)); setTo(today); }
  }

  useEffect(() => {
    if (!rangeOk) { setData(null); setLoading(false); setError(''); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    getDaybook(clinicSlug, from, to, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setData(value); setOpenDay(from === to ? from : null);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof DaybookApiError && failure.status === 401) { onSessionLost(); return; }
      if (failure instanceof DaybookApiError && failure.status === 403) { setDenied(true); return; }
      setError('The daybook could not be loaded. Refresh when the clinic service is available.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, from, to, rangeOk, reload]);

  const summary = useMemo(() => data ? summarize(data.rows, doctorId) : null, [data, doctorId]);
  useEffect(() => { if (summary && doctorId && !summary.doctors.some((doctor) => doctor.id === doctorId)) setDoctorId(''); }, [summary, doctorId]);
  const clinicView = data?.scope === 'clinic';
  const showMoney = !!data?.money;

  function download() {
    if (!data || !summary || summary.days.length === 0) return;
    const blob = new Blob([daybookCsv(summary.days, data.scope)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `daybook-${clinicSlug}-${from}${from === to ? '' : `-to-${to}`}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (denied) return <section className="workflow-access" role="alert"><h3>Daybook unavailable</h3><p>This staff account or clinic does not have access to the daybook.</p></section>;
  const t = summary?.totals;
  return <div className="daybook">
    <div className="workflow-intro"><div><span className="eyebrow">CLINIC DAYBOOK</span><h3>{role === 'doctor' ? 'My patients and fees' : 'Patients and collections'}</h3><p>{role === 'doctor' ? 'Visits assigned to you, day by day, with your consultation fees.' : 'Who came in, who was seen, and what was billed and received, day by day.'}</p></div><span className="workflow-pilot no-print">Synthetic pilot only</span></div>
    <p className="daybook-print-title">{clinicName} · Daybook · {from === to ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`}</p>
    <section className="workflow-card no-print" aria-label="Daybook range">
      <div className="daybook-controls">
        <div className="workflow-switch" role="group" aria-label="Date range">{PRESETS.map(({ id, label }) => <button type="button" key={id} className={preset === id ? 'is-active' : ''} aria-pressed={preset === id} onClick={() => choosePreset(id)}>{label}</button>)}</div>
        {preset === 'custom' && <div className="daybook-custom"><label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} /></label></div>}
        {clinicView && summary && summary.doctors.length > 0 && <label>Doctor<select value={doctorId} onChange={(event) => setDoctorId(event.target.value)}><option value="">All doctors</option>{summary.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name} ({doctor.attended} attended)</option>)}</select></label>}
        <div className="daybook-actions"><button type="button" className="workflow-link" onClick={() => setReload((value) => value + 1)} disabled={loading}>Refresh</button><button type="button" className="workflow-link" onClick={() => window.print()} disabled={!summary || summary.days.length === 0}>Print / save PDF</button><button type="button" className="workflow-action" onClick={download} disabled={!summary || summary.days.length === 0}>Download for Excel</button></div>
      </div>
      {!rangeOk && <p className="workflow-error" role="alert">Choose a range of up to 31 days, with the start on or before the end.</p>}
    </section>
    {loading ? <p role="status" className="workflow-muted">Loading daybook…</p> : error ? <p className="workflow-error" role="alert">{error}</p> : !data || !summary || !t ? null : <>
      <section className="daybook-cards" aria-label="Totals for this range">
        <div><span>Patients attended</span><strong>{t.attended}</strong><small>{t.booked} booked</small></div>
        <div><span>Consultations completed</span><strong>{t.completed}</strong><small>{Math.max(0, t.attended - t.completed)} still open</small></div>
        {showMoney && <div><span>{clinicView ? 'Total billed' : 'Consultation fees'}</span><strong>{formatPaise(clinicView ? t.billedPaise : t.consultationPaise)}</strong>{clinicView && <small>Consultation {formatPaise(t.consultationPaise)} · Pharmacy {formatPaise(t.pharmacyPaise)}</small>}</div>}
        {showMoney && clinicView && <div><span>Received</span><strong>{formatPaise(t.paidPaise)}</strong><small>Cash {formatPaise(t.methods.cash)} · UPI {formatPaise(t.methods.upi)} · Card {formatPaise(t.methods.card)}</small></div>}
        {showMoney && clinicView && <div className={t.outstandingPaise > 0 ? 'is-due' : ''}><span>Outstanding</span><strong>{formatPaise(t.outstandingPaise)}</strong><small>Billed but not yet received</small></div>}
      </section>
      {!showMoney && <p className="workflow-hint">Billing is not enabled for this clinic, so only visit counts are shown.</p>}
      {clinicView && !doctorId && summary.doctors.length > 1 && <section className="workflow-card" aria-labelledby="daybook-doctors"><h4 id="daybook-doctors">Patients attended by doctor</h4><ul className="daybook-doctors">{summary.doctors.map((doctor) => <li key={doctor.id}><button type="button" className="workflow-link no-print" onClick={() => setDoctorId(doctor.id)}>{doctor.name}</button><span className="daybook-print-only">{doctor.name}</span><strong>{doctor.attended}</strong></li>)}</ul></section>}
      <section className="workflow-card" aria-labelledby="daybook-days"><h4 id="daybook-days">Day by day</h4>
        {summary.days.length === 0 ? <p className="workflow-empty">No visits recorded in this range{doctorId ? ' for this doctor' : ''}.</p> : <div className="daybook-days">{summary.days.map((day) => {
          const open = openDay === day.date;
          return <div key={day.date} className={`daybook-day${open ? ' is-open' : ''}`}>
            <button type="button" className="daybook-day-head" aria-expanded={open} onClick={() => setOpenDay(open ? null : day.date)}>
              <strong>{dayLabel(day.date)}</strong><span>{day.attended} attended · {day.completed} completed</span>
              {showMoney && <span>{clinicView ? `${formatPaise(day.paidPaise)} received of ${formatPaise(day.billedPaise)}` : formatPaise(day.consultationPaise)}</span>}
            </button>
            <div className="daybook-day-body"><table><thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Status</th>{showMoney && <th>Fee</th>}{showMoney && clinicView && <><th>Pharmacy</th><th>Received</th><th>Due</th></>}</tr></thead>
              <tbody>{day.rows.map((row) => {
                const billed = (row.consultationPaise ?? 0) + (row.pharmacyPaise ?? 0);
                const hasBill = row.paidPaise !== null && row.paidPaise !== undefined;
                return <tr key={row.appointmentId}><td>{timeLabel(row.startAt)}</td><td>{row.patientName}</td><td>{row.doctorName}</td><td>{row.completed ? 'Completed' : row.attended ? 'Attended' : 'Booked'}</td>
                  {showMoney && <td>{row.consultationPaise === null ? '—' : formatPaise(row.consultationPaise)}</td>}
                  {showMoney && clinicView && <><td>{hasBill ? formatPaise(row.pharmacyPaise ?? 0) : '—'}</td><td>{hasBill ? formatPaise(row.paidPaise!) : '—'}</td><td>{hasBill ? formatPaise(Math.max(0, billed - row.paidPaise!)) : '—'}</td></>}</tr>;
              })}</tbody></table></div>
          </div>;
        })}</div>}
      </section>
      <p className="workflow-hint">Amounts are staff-entered records grouped by visit date, not bank-verified totals. "Attended" means checked in or seen by the doctor.</p>
    </>}
  </div>;
}
