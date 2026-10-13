import assert from 'node:assert/strict';
import test from 'node:test';
import { ConsultationApiError } from './consultationApi.ts';
import { listFinalizedPrescriptions, readFinalizedPrescription } from './prescriptionApi.ts';

const item = {
  appointmentId: 'appt-1', clinicDate: '2026-10-13', patientId: 'patient-1', patientName: 'Synthetic Patient',
  doctorId: 'doctor-1', doctorName: 'Dr Synthetic', startAt: '2026-10-13T09:30:00+05:30', finalizedAt: '2026-10-13T10:00:00+05:30',
};
const medicine = { name: 'Synthetic medicine', strength: '5 mg', dose: '1 tablet', route: 'oral',
  frequency: '', duration: '3 days', instructions: 'Synthetic directions',
  timing: { timesOfDay: ['morning', 'night'], mealRelation: 'after' } };
const printablePrescription = {
  clinic: { slug: 'goodwell', displayName: 'Goodwell Clinic' },
  doctor: { id: 'doctor-1', displayName: 'Dr Synthetic' },
  patient: { id: 'patient-1', fullName: 'Synthetic Patient', ageYears: 30, sex: 'female' },
  appointmentDate: item.clinicDate, finalizedAt: item.finalizedAt, medications: [medicine],
};
function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('reception/pharmacy queue and read use same-origin cookies without patient data in URLs', async () => {
  const calls = [];
  const restore = mockFetch(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ items: [item] });
    return Response.json({ status: 'finalized', printablePrescription });
  });
  try {
    const queue = await listFinalizedPrescriptions('goodwell', '2026-10-13');
    const print = await readFinalizedPrescription('goodwell', queue[0], 'csrf-1');
    assert.equal(queue.length, 1);
    assert.deepEqual(print.medications, [medicine]);
    assert.equal(calls[0].url, '/api/workflow/clinics/goodwell/consultations/prescriptions?date=2026-10-13');
    assert.equal(calls[1].url, '/api/workflow/clinics/goodwell/consultations/prescriptions/read');
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[1].options.credentials, 'include');
    assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf-1');
    assert.deepEqual(JSON.parse(calls[1].options.body), { appointmentId: 'appt-1', clinicDate: '2026-10-13' });
    assert.equal(calls[1].url.includes('patient-1'), false);
  } finally { restore(); }
});

test('drafts, wrong clinic or patient, and extra clinical fields fail closed', async () => {
  for (const bad of [
    { status: 'draft', printablePrescription },
    { status: 'finalized', printablePrescription: { ...printablePrescription, clinic: { slug: 'blesswell', displayName: 'Blesswell' } } },
    { status: 'finalized', printablePrescription: { ...printablePrescription, patient: { ...printablePrescription.patient, id: 'patient-2' } } },
    { status: 'finalized', printablePrescription, encounter: { note: 'must not be sent' } },
    { status: 'finalized', printablePrescription: { ...printablePrescription, patient: { ...printablePrescription.patient, phone: '+000' } } },
  ]) {
    const restore = mockFetch(async () => Response.json(bad));
    try { await assert.rejects(readFinalizedPrescription('goodwell', item, 'csrf-1'), ConsultationApiError); }
    finally { restore(); }
  }
  const restore = mockFetch(async () => Response.json({ items: [{ ...item, note: 'must not be sent' }] }));
  try { await assert.rejects(listFinalizedPrescriptions('goodwell', item.clinicDate), ConsultationApiError); }
  finally { restore(); }
});

test('handoff preserves authorization failures and rejects non-JSON fallback', async () => {
  for (const status of [401, 403, 404, 503]) {
    const restore = mockFetch(async () => Response.json({ error: 'Unavailable' }, { status }));
    try {
      await assert.rejects(listFinalizedPrescriptions('goodwell', item.clinicDate),
        (error) => error instanceof ConsultationApiError && error.status === status);
    } finally { restore(); }
  }
  const html = mockFetch(async () => new Response('<html>edge fallback</html>', { headers: { 'Content-Type': 'text/html' } }));
  try { await assert.rejects(readFinalizedPrescription('goodwell', item, 'csrf'), ConsultationApiError); }
  finally { html(); }
});
