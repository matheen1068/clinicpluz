import assert from 'node:assert/strict';
import test from 'node:test';
import { doctorDaySlots, PILOT_DOCTOR_SLOTS } from './scheduleGrid.ts';

const visit = (appointmentId, startAt) => ({
  appointmentId, clinicDate: '2026-10-13', patientId: `patient-${appointmentId}`,
  patientName: `Synthetic ${appointmentId}`, doctorId: 'doctor-1', doctorName: 'Dr Synthetic',
  startAt, appointmentStatus: 'booked', encounterStatus: 'draft',
});

test('doctor day cards use the provisional 30-minute schedule without inventing appointments', () => {
  assert.equal(PILOT_DOCTOR_SLOTS.length, 18);
  assert.equal(PILOT_DOCTOR_SLOTS[0], '09:30');
  assert.equal(PILOT_DOCTOR_SLOTS.at(-1), '18:00');
  const planned = doctorDaySlots([visit('a', '2026-10-13T09:30:00+05:30')]);
  assert.deepEqual(planned.slots[0].visits.map((item) => item.appointmentId), ['a']);
  assert.equal(planned.slots[1].visits.length, 0);
  assert.deepEqual(planned.outside, []);
});

test('all recorded visits remain visible, including duplicate or off-hours times', () => {
  const planned = doctorDaySlots([
    visit('a', '2026-10-13T04:00:00Z'), visit('b', '2026-10-13T09:30:00+05:30'),
    visit('c', '2026-10-13T18:30:00+05:30'),
  ]);
  assert.deepEqual(planned.slots[0].visits.map((item) => item.appointmentId), ['a', 'b']);
  assert.deepEqual(planned.outside.map((item) => item.appointmentId), ['c']);
});
