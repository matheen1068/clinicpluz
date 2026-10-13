import assert from 'node:assert/strict';
import test from 'node:test';
import { ConsultationApiError } from './consultationApi.ts';
import { previewPrescriptionEmail, sendPrescriptionEmail } from './prescriptionEmailApi.ts';

const selection = { appointmentId: 'appt-1', clinicDate: '2026-10-13' };
function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('reception email preview and send use only server-stored recipient and confirmed appointment identity', async () => {
  const calls = [];
  const restore = mockFetch(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? Response.json({ status: 'ready', recipientEmail: 'synthetic@example.test', recipientMasked: 's***@example.test' })
      : Response.json({ status: 'accepted', recipientMasked: 's***@example.test' }, { status: 202 });
  });
  try {
    const preview = await previewPrescriptionEmail('goodwell', selection, 'session-csrf');
    assert.equal(preview.recipientEmail, 'synthetic@example.test');
    const result = await sendPrescriptionEmail('goodwell', selection, 'session-csrf', preview.recipientEmail);
    assert.equal(result.status, 'accepted');
    assert.equal(calls[0].url, '/api/workflow/clinics/goodwell/consultations/prescriptions/email/preview');
    assert.equal(calls[1].url, '/api/workflow/clinics/goodwell/consultations/prescriptions/email');
    for (const { url, options } of calls) {
      assert.equal(options.method, 'POST');
      assert.equal(options.credentials, 'include');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers['X-CSRF-Token'], 'session-csrf');
      assert.equal(url.includes('synthetic@example.test'), false);
    }
    assert.deepEqual(JSON.parse(calls[0].options.body), selection);
    assert.deepEqual(JSON.parse(calls[1].options.body), { ...selection, confirmPatientEmail: true, expectedRecipientEmail: preview.recipientEmail });
  } finally { restore(); }
});

test('uncertain email outcome is surfaced without silently retrying', async () => {
  let calls = 0;
  const restore = mockFetch(async () => { calls += 1; return Response.json({ status: 'unknown', recipientMasked: 's***@example.test' }, { status: 409 }); });
  try {
    assert.deepEqual(await sendPrescriptionEmail('goodwell', selection, 'csrf', 'synthetic@example.test'),
      { status: 'unknown', recipientMasked: 's***@example.test' });
    assert.equal(calls, 1);
  } finally { restore(); }
});

test('missing email, disabled service, wrong status and edge fallback fail closed', async () => {
  for (const status of [401, 403, 404, 409, 422, 503]) {
    const restore = mockFetch(async () => Response.json({ error: 'Unavailable' }, { status }));
    try {
      await assert.rejects(previewPrescriptionEmail('goodwell', selection, 'csrf'),
        (error) => error instanceof ConsultationApiError && error.status === status);
    } finally { restore(); }
  }
  const malformed = mockFetch(async () => Response.json({ status: 'ready', recipientEmail: 'synthetic@example.test', recipientMasked: '' }));
  try { await assert.rejects(previewPrescriptionEmail('goodwell', selection, 'csrf'), ConsultationApiError); }
  finally { malformed(); }
  const html = mockFetch(async () => new Response('<html>edge fallback</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  try { await assert.rejects(sendPrescriptionEmail('goodwell', selection, 'csrf', 'synthetic@example.test'), ConsultationApiError); }
  finally { html(); }
});
