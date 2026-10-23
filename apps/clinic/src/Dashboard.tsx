import { useEffect, useState } from 'react';
import { getDashboard, DashboardApiError, type DashboardSummary } from './dashboardApi';
import { pilotDateToday } from './workflowApi';

interface Props {
  clinicSlug: string;
  role: 'doctor' | 'receptionist' | 'clinic_admin';
  onSessionLost: () => void;
}

export default function Dashboard({ clinicSlug, role, onSessionLost }: Props) {
  const [date, setDate] = useState(pilotDateToday);
  const [reload, setReload] = useState(0);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setSummary(null); setError('');
    void getDashboard(clinicSlug, date, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if ((role === 'doctor' && value.scope !== 'doctor') || (role !== 'doctor' && value.scope !== 'clinic')) {
        setError('Dashboard access could not be verified.');
      } else setSummary(value);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof DashboardApiError && cause.status === 401) onSessionLost();
      else setError(cause instanceof DashboardApiError && cause.status === 403
        ? 'Your role does not have access to this dashboard.'
        : 'Daily totals could not be loaded. Refresh when the clinic service is available.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clinicSlug, date, reload, role, onSessionLost]);

  const counts = summary?.counts;
  return <div className="dashboard">
    <div className="workflow-intro"><div><span className="eyebrow">DAILY CLINIC VIEW</span><h3>{role === 'doctor' ? 'My dashboard' : 'Reception dashboard'}</h3><p>{role === 'doctor' ? 'Your assigned appointments and consultations for the selected day.' : 'Appointments and consultations across this clinic for the selected day.'}</p></div><span className="workflow-pilot">Synthetic pilot only</span></div>
    <section className="workflow-card dashboard-panel" aria-labelledby="dashboard-heading"><div className="workflow-card-head dashboard-head"><div><h4 id="dashboard-heading">Appointment overview</h4><p>Counts update from the clinic service when you refresh.</p></div><div className="workflow-queue-controls"><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button type="button" className="workflow-link" onClick={() => setReload((value) => value + 1)} disabled={loading}>Refresh dashboard</button></div></div>
      {loading ? <p className="workflow-muted" role="status">Loading daily totals…</p> : error ? <p className="workflow-error" role="alert">{error}</p> : counts && <><div className="dashboard-stats" aria-label="Daily appointment totals">
        <div className="dashboard-stat"><span>Total appointments</span><strong>{counts.total}</strong><small>All recorded visits</small></div>
        <div className="dashboard-stat"><span>Booked</span><strong>{counts.booked}</strong><small>Awaiting arrival</small></div>
        <div className="dashboard-stat"><span>Waiting</span><strong>{counts.pending}</strong><small>Checked in; consultation pending</small></div>
        <div className="dashboard-stat"><span>Completed</span><strong>{counts.completed}</strong><small>Consultation finalized</small></div>
      </div><p className="dashboard-footnote">{counts.phone} phone booking{counts.phone === 1 ? '' : 's'} · {counts.walkIn} walk-in{counts.walkIn === 1 ? '' : 's'}. Booked, waiting, and completed divide the total without overlap.</p></>}
    </section>
  </div>;
}
