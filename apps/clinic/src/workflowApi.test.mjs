import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAppointment, getAppointments, getDoctors, pilotDateToday, pilotSlotToIso,
  registerPatient, searchPatients, WorkflowApiError,
} from './workflowApi.ts';

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('patient search keeps patient names out of the URL and includes session and CSRF', async () => {
  const restore = mockFetch(async (path, options) => {
    assert.equal(path, '/api/workflow/clinics/goodwell/patients/search');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['X-CSRF-Token'], 'session-csrf');
    assert.deepEqual(JSON.parse(options.body), { query: 'Maya Lin' });
    return Response.json({ items: [{ id: 'p1', fullName: 'Maya Lin', phone: '9999999999', ageYears: 36, sex: 'female' }] });
  });
  try {
    assert.equal((await searchPatients('goodwell', ' Maya Lin ', 'session-csrf'))[0].id, 'p1');
    await assert.rejects(searchPatients('goodwell', 'M', 'session-csrf'), WorkflowApiError);
  } finally { restore(); }
});

test('registration and booking send typed JSON and preserve conflict status', async () => {
  const calls = [];
  const restore = mockFetch(async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('/patients')) return Response.json({ patient: { id: 'p1', fullName: 'Maya Lin', phone: '9999999999', ageYears: 36, sex: 'female' } }, { status: 201 });
    return Response.json({ error: 'slot occupied' }, { status: 409 });
  });
  try {
    assert.equal((await registerPatient('goodwell', { fullName: 'Maya Lin', phone: '9999999999', ageYears: 36, sex: 'female' }, 'csrf')).id, 'p1');
    await assert.rejects(createAppointment('goodwell', { patientId: 'p1', doctorId: 'd1', startAt: '2026-10-10T04:00:00.000Z', source: 'phone' }, 'csrf'), (error) => error instanceof WorkflowApiError && error.status === 409);
    assert.equal(calls[0].path, '/api/workflow/clinics/goodwell/patients');
    assert.equal(calls[1].path, '/api/workflow/clinics/goodwell/appointments');
    assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf');
    assert.equal(JSON.parse(calls[1].options.body).source, 'phone');
  } finally { restore(); }
});

test('doctor and date queue calls use clinic-scoped routes and reject malformed responses', async () => {
  let restore = mockFetch(async (path, options) => {
    assert.equal(options.credentials, 'include');
    if (path.endsWith('/doctors')) return Response.json({ items: [{ id: 'd1', displayName: 'Dr A' }] });
    assert.equal(path, '/api/workflow/clinics/goodwell/appointments?date=2026-10-10');
    return Response.json({ items: [] });
  });
  try {
    assert.equal((await getDoctors('goodwell'))[0].displayName, 'Dr A');
    assert.deepEqual(await getAppointments('goodwell', '2026-10-10'), []);
  } finally { restore(); }

  restore = mockFetch(async () => Response.json({ items: [{ id: 'd1' }] }));
  try { await assert.rejects(getDoctors('goodwell'), WorkflowApiError); }
  finally { restore(); }
});

test('non-JSON edge errors fail closed and cannot become a role or entitlement decision', async () => {
  const restore = mockFetch(async () => new Response('<Error>AccessDenied</Error>', { status: 403, headers: { 'Content-Type': 'application/xml' } }));
  try { await assert.rejects(getDoctors('goodwell'), (error) => error instanceof WorkflowApiError && error.status === null); }
  finally { restore(); }
});

test('JSON authentication and entitlement denials are surfaced and invalid clinic context never fetches', async () => {
  let calls = 0;
  let restore = mockFetch(async () => { calls += 1; return Response.json({ error: 'sign in' }, { status: 401 }); });
  try {
    await assert.rejects(getDoctors('goodwell'), (error) => error instanceof WorkflowApiError && error.status === 401);
    await assert.rejects(getDoctors('../blesswell'), WorkflowApiError);
    assert.equal(calls, 1);
  } finally { restore(); }

  restore = mockFetch(async () => Response.json({ error: 'module disabled' }, { status: 403 }));
  try { await assert.rejects(getAppointments('goodwell', '2026-10-10'), (error) => error instanceof WorkflowApiError && error.status === 403); }
  finally { restore(); }
});

test('successful walk-in booking accepts the server status instead of inventing one locally', async () => {
  const restore = mockFetch(async () => Response.json({ appointment: {
    id: 'a1', patientId: 'p1', doctorId: 'd1', startAt: '2026-10-10T04:00:00.000Z', source: 'walk_in', status: 'checked_in',
  } }, { status: 201 }));
  try {
    const result = await createAppointment('goodwell', { patientId: 'p1', doctorId: 'd1', startAt: '2026-10-10T04:00:00.000Z', source: 'walk_in' }, 'csrf');
    assert.equal(result.status, 'checked_in');
  } finally { restore(); }
});

test('the provisional 30-minute schedule uses Asia/Kolkata, independent of device timezone', () => {
  assert.equal(pilotSlotToIso('2026-10-10', '09:30'), '2026-10-10T04:00:00.000Z');
  assert.equal(pilotSlotToIso('2026-10-10', '18:00'), '2026-10-10T12:30:00.000Z');
  assert.equal(pilotSlotToIso('2026-10-10', '18:30'), null);
  assert.equal(pilotSlotToIso('2026-02-30', '09:30'), null);
  assert.equal(pilotDateToday(new Date('2026-10-09T20:00:00Z')), '2026-10-10');
});
