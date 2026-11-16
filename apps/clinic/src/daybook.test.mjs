import assert from 'node:assert/strict';
import test from 'node:test';
import { daybookCsv, parseDaybook, shiftDay, summarize, validRange, DaybookApiError } from './daybook.ts';

const row = (extra) => ({ clinicDate: '2026-11-17', appointmentId: 'a1', patientId: 'p1', patientName: 'Amina Khan', doctorId: 'd1', doctorName: 'Dr One',
  startAt: '2026-11-17T04:30:00.000Z', source: 'phone', attended: true, completed: true, consultationPaise: 50_000,
  pharmacyPaise: 10_000, paidPaise: 40_000, receiptIssued: false, methods: { cash: 40_000, upi: 0, card: 0 }, ...extra });

test('ranges are limited to 31 days and day maths crosses months', () => {
  assert.equal(shiftDay('2026-11-17', -29), '2026-10-19');
  assert.equal(validRange('2026-10-18', '2026-11-17'), true);
  assert.equal(validRange('2026-10-17', '2026-11-17'), false);
  assert.equal(validRange('2026-11-18', '2026-11-17'), false);
  assert.equal(validRange('2026-02-30', '2026-03-01'), false);
});

test('summary totals by day and filters by doctor', () => {
  const rows = [row({}), row({ appointmentId: 'a2', doctorId: 'd2', doctorName: 'Dr Two', completed: false, consultationPaise: null, pharmacyPaise: null, paidPaise: null, methods: null }),
    row({ appointmentId: 'a3', clinicDate: '2026-11-16', startAt: '2026-11-16T05:00:00.000Z', attended: false, completed: false, paidPaise: 60_000, methods: { cash: 0, upi: 60_000, card: 0 } })];
  const all = summarize(rows, '');
  assert.equal(all.totals.booked, 3);
  assert.equal(all.totals.attended, 2);
  assert.equal(all.totals.completed, 1);
  assert.equal(all.totals.billedPaise, 120_000);
  assert.equal(all.totals.paidPaise, 100_000);
  assert.equal(all.totals.outstandingPaise, 20_000);
  assert.deepEqual(all.totals.methods, { cash: 40_000, upi: 60_000, card: 0 });
  assert.deepEqual(all.days.map((day) => day.date), ['2026-11-17', '2026-11-16']);
  assert.deepEqual(all.doctors, [{ id: 'd1', name: 'Dr One', attended: 1 }, { id: 'd2', name: 'Dr Two', attended: 1 }]);
  const two = summarize(rows, 'd2');
  assert.equal(two.totals.booked, 1);
  assert.equal(two.totals.billedPaise, 0);
  assert.equal(two.doctors.length, 2);
});

test('CSV escapes text, blocks formulas, and omits clinic money for a doctor', () => {
  const days = summarize([row({ patientName: '=HYPERLINK("x"), Evil' })], '').days;
  const csv = daybookCsv(days, 'clinic');
  assert.equal(csv.startsWith('﻿Date,Time,Patient'), true);
  assert.equal(csv.includes(`"'=HYPERLINK(""x""), Evil"`), true);
  assert.equal(csv.includes('500.00,100.00,600.00,400.00,200.00,400.00,0.00,0.00,No'), true);
  const doctorCsv = daybookCsv(days, 'doctor');
  assert.equal(doctorCsv.includes('Received'), false);
  assert.equal(doctorCsv.trimEnd().endsWith('500.00'), true);
});

test('daybook responses are strictly parsed', () => {
  const ok = { from: '2026-11-11', to: '2026-11-17', scope: 'clinic', money: true, rows: [row({})] };
  assert.equal(parseDaybook(ok, '2026-11-11', '2026-11-17').rows.length, 1);
  for (const bad of [{ ...ok, from: '2026-11-10' }, { ...ok, scope: 'all' }, { ...ok, rows: [row({ clinicDate: '2026-11-18' })] },
    { ...ok, rows: [row({ paidPaise: -1 })] }, { ...ok, rows: [row({ methods: { cash: 1 } })] }, { ...ok, rows: [row({ patientName: '' })] }]) {
    assert.throws(() => parseDaybook(bad, '2026-11-11', '2026-11-17'), DaybookApiError);
  }
});
