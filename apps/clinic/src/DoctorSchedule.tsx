import type { ConsultationQueueItem } from './consultationApi';
import { doctorDaySlots } from './scheduleGrid';

interface Props {
  visits: ConsultationQueueItem[];
  selected: ConsultationQueueItem | null;
  onSelect: (visit: ConsultationQueueItem) => void;
}

function visitCard(item: ConsultationQueueItem, selected: ConsultationQueueItem | null, onSelect: Props['onSelect']) {
  return <button type="button" key={item.appointmentId}
    className={`doctor-slot-visit${selected?.appointmentId === item.appointmentId ? ' is-selected' : ''}`}
    aria-pressed={selected?.appointmentId === item.appointmentId}
    onClick={() => onSelect(item)}>
    <strong>{item.patientName}</strong>
    <span>{item.appointmentStatus.replaceAll('_', ' ')} · {item.encounterStatus === 'finalized' ? 'Finalized' : 'Draft / not started'}</span>
    <small>Open visit →</small>
  </button>;
}

export default function DoctorSchedule({ visits, selected, onSelect }: Props) {
  const { slots, outside } = doctorDaySlots(visits);
  const finalized = visits.filter((item) => item.encounterStatus === 'finalized').length;
  return <div className="doctor-day">
    <div className="doctor-day-summary">
      <div><span className="eyebrow">MY CLINIC DAY</span><h5>Appointment schedule</h5><p>Reception manages bookings. Select a recorded visit to open its encounter.</p></div>
      <div className="doctor-day-counts" aria-label="Daily visit summary"><span><strong>{visits.length}</strong> recorded visits</span><span><strong>{finalized}</strong> finalized</span></div>
    </div>
    <p className="doctor-day-caveat">Provisional pilot slots: 09:30–18:30, Asia/Kolkata. An empty card only means no visit is recorded here; it does not confirm availability.</p>
    <ol className="doctor-slot-grid" aria-label="Thirty-minute appointment cards">
      {slots.map(({ time, visits: booked }) => <li key={time} className={`doctor-slot${booked.length ? ' has-visit' : ''}`}>
        <div className="doctor-slot-time"><strong>{time}</strong><span>{booked.length ? `${booked.length} visit${booked.length === 1 ? '' : 's'}` : 'No visit recorded'}</span></div>
        {booked.map((item) => visitCard(item, selected, onSelect))}
      </li>)}
    </ol>
    {outside.length > 0 && <div className="doctor-day-other"><h5>Other recorded times</h5><p>These visits fall outside the provisional card schedule and remain visible.</p><ul>{outside.map((item) => <li key={item.appointmentId}><span>{new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(item.startAt))}</span>{visitCard(item, selected, onSelect)}</li>)}</ul></div>}
  </div>;
}
