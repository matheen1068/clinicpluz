import assert from 'node:assert/strict';
import test from 'node:test';
import { DashboardApiError, getDashboard } from './dashboardApi.ts';

test('daily dashboard requests only the selected clinic and date', async () => {
  let requested = '';
  globalThis.fetch = async (url, init) => {
    requested = url;
    assert.equal(init.credentials, 'include');
    return new Response(JSON.stringify({ date: '2026-10-23', scope: 'doctor', counts: {
      total: 4, booked: 1, checkedIn: 3, pending: 2, completed: 1, phone: 2, walkIn: 2,
    } }), { headers: { 'Content-Type': 'application/json' } });
  };
  const result = await getDashboard('goodwell', '2026-10-23');
  assert.equal(requested, '/api/workflow/clinics/goodwell/dashboard?date=2026-10-23');
  assert.equal(result.counts.pending, 2);
});

test('dashboard fails closed on inconsistent or non-API totals', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ date: '2026-10-23', scope: 'clinic', counts: {
    total: 4, booked: 3, checkedIn: 1, pending: 2, completed: 1, phone: 4, walkIn: 0,
  } }), { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(() => getDashboard('goodwell', '2026-10-23'), DashboardApiError);
  globalThis.fetch = async () => new Response('<html>missing</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(() => getDashboard('goodwell', '2026-10-23'), (error) => error instanceof DashboardApiError && error.status === null);
});
