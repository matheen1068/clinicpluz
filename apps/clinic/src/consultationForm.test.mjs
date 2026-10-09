import assert from 'node:assert/strict';
import test from 'node:test';
import { completeForFinalize, emptyMedication, emptyNote, mergeRecoveredFields, parseVitalForm, snapshotEdits, toKolkataIso, vitalFormFrom } from './consultationForm.ts';

const now = new Date('2026-10-10T05:00:00.000Z');

test('observation time is interpreted in the provisional clinic timezone and validates the calendar', () => {
  assert.equal(toKolkataIso('2026-10-10T10:30'), '2026-10-10T05:00:00.000Z');
  assert.equal(toKolkataIso('2026-02-30T10:30'), null);
});

test('vitals need a measured value, paired BP, backend-aligned ranges, and a recent observation time', () => {
  const base = vitalFormFrom(null, now);
  assert.equal(parseVitalForm(base, now), null);
  assert.deepEqual(parseVitalForm({ ...base, pulseBpm: '72' }, now), { observedAt: now.toISOString(), pulseBpm: 72 });
  assert.equal(parseVitalForm({ ...base, systolicBpMmHg: '120' }, now), null);
  assert.deepEqual(parseVitalForm({ ...base, systolicBpMmHg: '120', diastolicBpMmHg: '80' }, now),
    { observedAt: now.toISOString(), systolicBpMmHg: 120, diastolicBpMmHg: 80 });
  assert.equal(parseVitalForm({ ...base, pulseBpm: '351' }, now), null);
  assert.equal(parseVitalForm({ ...base, spo2Percent: '101' }, now), null);
  assert.equal(parseVitalForm({ ...base, pulseBpm: '72', observedAt: '2026-08-01T10:30' }, now), null);
  assert.equal(parseVitalForm({ ...base, pulseBpm: '72', observedAt: '2026-10-10T10:36' }, now), null);
});

test('finalization requires doctor-entered assessment, plan, and complete medicine instructions', () => {
  const note = { ...emptyNote(), assessment: 'Synthetic assessment', plan: 'Synthetic plan' };
  assert.equal(completeForFinalize(emptyNote(), []), false);
  assert.equal(completeForFinalize(note, []), true);
  const medicine = { ...emptyMedication(), name: 'Synthetic medicine', dose: '1 tablet', route: 'oral',
    frequency: 'once daily', duration: '3 days', instructions: 'Synthetic instruction' };
  assert.equal(completeForFinalize(note, [medicine]), true);
  assert.equal(completeForFinalize(note, [{ ...medicine, dose: '' }]), false);
});

test('recovery of a changed note does not carry stale vitals or other server note fields', () => {
  const oldVitals = { ...vitalFormFrom(null, now), pulseBpm: '70' };
  const originalNote = { ...emptyNote(), exam: 'Earlier exam' };
  const changedNote = { ...originalNote, assessment: 'Local synthetic assessment' };
  const snapshot = snapshotEdits(oldVitals, oldVitals, changedNote, originalNote, [], []);
  assert.ok(snapshot);
  assert.deepEqual(snapshot.vitalChanges, {});
  assert.deepEqual(snapshot.noteChanges, { assessment: 'Local synthetic assessment' });
  assert.equal(snapshot.medications, null);
  const serverVitals = { ...oldVitals, pulseBpm: '80' };
  const serverNote = { ...originalNote, exam: 'Newer server exam' };
  assert.deepEqual(mergeRecoveredFields(snapshot, serverVitals, serverNote), {
    vitals: serverVitals,
    note: { ...serverNote, assessment: 'Local synthetic assessment' },
  });
});

test('recovery preserves only changed vital fields and copies a changed medicine list', () => {
  const originalVitals = { ...vitalFormFrom(null, now), pulseBpm: '70', weightKg: '60' };
  const changedVitals = { ...originalVitals, pulseBpm: '72' };
  const medicine = { ...emptyMedication(), name: 'Synthetic medicine' };
  const snapshot = snapshotEdits(changedVitals, originalVitals, emptyNote(), emptyNote(), [medicine], []);
  assert.ok(snapshot);
  assert.deepEqual(snapshot.vitalChanges, { pulseBpm: '72' });
  assert.equal(snapshot.localObservedAt, originalVitals.observedAt);
  assert.deepEqual(snapshot.medications, [medicine]);
  medicine.name = 'Changed after snapshot';
  const serverVitals = { ...originalVitals, pulseBpm: '75', weightKg: '63' };
  assert.deepEqual(mergeRecoveredFields(snapshot, serverVitals, emptyNote()).vitals,
    { ...serverVitals, pulseBpm: '72' });
  assert.equal(snapshot.medications[0].name, 'Synthetic medicine');
});
