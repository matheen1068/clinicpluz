import assert from 'node:assert/strict';
import test from 'node:test';
import { ConsultationApiError } from './consultationApi.ts';
import { listPatientHistory, readPatientHistory } from './patientHistoryApi.ts';

const context = {
  clinicSlug: 'goodwell', appointmentId: 'appointment-current', clinicDate: '2026-10-11',
  patientId: 'patient-1', currentVisitAt: '2026-10-11T10:00:00+05:30',
};
const summary = {
  historyId: 'opaque#history-1', clinicSlug: 'goodwell', patientId: 'patient-1', status: 'finalized',
  visitAt: '2026-10-10T09:30:00+05:30', finalizedAt: '2026-10-10T10:15:00+05:30',
  doctor: { id: 'doctor-2', displayName: 'Dr Synthetic B' },
};
const note = {
  chiefComplaint: 'Synthetic complaint', history: '', exam: 'Synthetic exam',
  assessment: 'Synthetic assessment', plan: 'Synthetic plan',
};
const medication = {
  name: 'Synthetic medicine', strength: '5 mg', dose: '1 tablet', route: 'oral',
  frequency: 'once daily', duration: '3 days', instructions: 'Synthetic instructions',
};
function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('history pagination uses body-only opaque tokens and a clinic session', async () => {
  const calls = [];
  const restore = mockFetch(async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, '/api/workflow/clinics/goodwell/consultations/history/list');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-CSRF-Token'], 'session-csrf');
    return Response.json(calls.length === 1
      ? { items: [summary], nextCursor: 'opaque#page-2' }
      : { items: [{ ...summary, historyId: 'opaque#history-2', visitAt: '2026-10-09T09:30:00+05:30' }], nextCursor: null });
  });
  try {
    const first = await listPatientHistory(context, 'session-csrf');
    const second = await listPatientHistory(context, 'session-csrf', first.nextCursor);
    assert.equal(first.items[0].historyId, summary.historyId);
    assert.equal(second.items[0].historyId, 'opaque#history-2');
    assert.deepEqual(JSON.parse(calls[0].options.body), { appointmentId: context.appointmentId, clinicDate: context.clinicDate });
    assert.deepEqual(JSON.parse(calls[1].options.body), { appointmentId: context.appointmentId, clinicDate: context.clinicDate, cursor: 'opaque#page-2' });
    assert.equal(calls[1].url.includes(context.patientId), false);
    assert.equal(calls[1].url.includes('opaque#'), false);
  } finally { restore(); }
});

test('an expired page cursor can be discarded and the first page requested again', async () => {
  const bodies = [];
  const restore = mockFetch(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 2) return Response.json({ error: 'Cursor expired' }, { status: 400 });
    return Response.json({ items: [summary], nextCursor: 'opaque#page-2' });
  });
  try {
    const first = await listPatientHistory(context, 'csrf');
    await assert.rejects(listPatientHistory(context, 'csrf', first.nextCursor),
      (error) => error instanceof ConsultationApiError && error.status === 400);
    const refreshed = await listPatientHistory(context, 'csrf');
    assert.deepEqual(refreshed.items, first.items);
    assert.deepEqual(bodies[0], bodies[2]);
    assert.equal(bodies[2].cursor, undefined);
    assert.equal(bodies[1].cursor, 'opaque#page-2');
  } finally { restore(); }
});

test('history detail remains read-only and must match the selected finalized visit', async () => {
  const restore = mockFetch(async (url, options) => {
    assert.equal(url, '/api/workflow/clinics/goodwell/consultations/history/detail');
    assert.deepEqual(JSON.parse(options.body), {
      appointmentId: context.appointmentId, clinicDate: context.clinicDate, historyId: summary.historyId,
    });
    return Response.json({ history: {
      ...summary,
      vitals: { observedAt: summary.visitAt, recordedAt: summary.visitAt, recordedBySub: 'nurse-1',
        recordedByDisplayName: 'Nurse Synthetic', pulseBpm: 72 },
      note, medications: [medication],
    } });
  });
  try {
    const detail = await readPatientHistory(context, summary, 'session-csrf');
    assert.equal(detail.status, 'finalized');
    assert.equal(detail.note.assessment, note.assessment);
    assert.equal(detail.vitals.pulseBpm, 72);
    assert.deepEqual(detail.medications, [{ ...medication, timing: null }]);
  } finally { restore(); }
});

test('draft, wrong-patient, wrong-clinic, and current-or-later visits fail closed', async () => {
  for (const changed of [
    { status: 'draft' }, { patientId: 'patient-2' }, { clinicSlug: 'blesswell' },
    { visitAt: context.currentVisitAt }, { visitAt: '2026-10-12T09:30:00+05:30' },
  ]) {
    const restore = mockFetch(async () => Response.json({ items: [{ ...summary, ...changed }], nextCursor: null }));
    try {
      await assert.rejects(listPatientHistory(context, 'csrf'),
        (error) => error instanceof ConsultationApiError && error.status === null);
    } finally { restore(); }
  }
  for (const changed of [{ status: 'draft' }, { patientId: 'patient-2' }, { historyId: 'other-history' }]) {
    const restore = mockFetch(async () => Response.json({ history: { ...summary, ...changed, vitals: null, note, medications: [] } }));
    try { await assert.rejects(readPatientHistory(context, summary, 'csrf'), ConsultationApiError); }
    finally { restore(); }
  }
});

test('malformed pagination, missing clinical fields, and edge HTML fail closed', async () => {
  for (const page of [
    { items: [summary, summary], nextCursor: null },
    { items: [], nextCursor: 'more' },
    { items: [summary], nextCursor: 'same-cursor' },
    { items: [{ ...summary, historyId: 'history-older', visitAt: '2026-10-08T09:30:00+05:30' }, summary], nextCursor: null },
  ]) {
    const restore = mockFetch(async () => Response.json(page));
    try { await assert.rejects(listPatientHistory(context, 'csrf', 'same-cursor'), ConsultationApiError); }
    finally { restore(); }
  }
  const missingNote = mockFetch(async () => Response.json({ history: { ...summary, vitals: null, medications: [] } }));
  try { await assert.rejects(readPatientHistory(context, summary, 'csrf'), ConsultationApiError); }
  finally { missingNote(); }
  const html = mockFetch(async () => new Response('<html>Not an API</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  try { await assert.rejects(listPatientHistory(context, 'csrf'), ConsultationApiError); }
  finally { html(); }
});

test('authorization status is preserved, and invalid context never fetches', async () => {
  for (const status of [401, 403, 404, 503]) {
    const restore = mockFetch(async () => Response.json({ error: 'Unavailable' }, { status }));
    try {
      await assert.rejects(listPatientHistory(context, 'csrf'),
        (error) => error instanceof ConsultationApiError && error.status === status);
    } finally { restore(); }
  }
  let calls = 0;
  const restore = mockFetch(async () => { calls += 1; return Response.json({}); });
  try {
    await assert.rejects(listPatientHistory({ ...context, clinicSlug: '../other' }, 'csrf'), ConsultationApiError);
    await assert.rejects(listPatientHistory(context, '', undefined), ConsultationApiError);
    await assert.rejects(listPatientHistory(context, 'csrf', '\nmalformed'), ConsultationApiError);
    await assert.rejects(readPatientHistory(context, { ...summary, historyId: '' }, 'csrf'), ConsultationApiError);
    await assert.rejects(readPatientHistory(context, { ...summary, patientId: 'patient-2' }, 'csrf'), ConsultationApiError);
    assert.equal(calls, 0);
  } finally { restore(); }
});
