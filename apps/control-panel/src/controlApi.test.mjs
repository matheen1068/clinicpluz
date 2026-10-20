import assert from 'node:assert/strict';
import test from 'node:test';
import { ControlApi, ControlApiError, MODULES } from './controlApi.ts';
import { base64url, configFromEnv } from './oauth.ts';

const customer = { id: '99c12861-1205-42bf-a6dc-8aff73f88219', displayName: 'Goodwell Healthcare', createdAt: '2026-10-20T08:00:00Z', version: 1 };
const branch = { slug: 'goodwell-central', customerId: '99c12861-1205-42bf-a6dc-8aff73f88219', branchName: 'Central', displayName: 'Goodwell Central', active: false, version: 1 };
const modules = Object.fromEntries(MODULES.map((key) => [key, false]));

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('API cannot call without an in-memory operator access token', async () => {
  const restore = mockFetch(async () => { throw new Error('must not call'); });
  try {
    await assert.rejects(new ControlApi(() => null).customers(), (error) => error instanceof ControlApiError && error.status === 401);
  } finally { restore(); }
});

test('customer and branch reads send operator bearer token without clinic cookies', async () => {
  const calls = [];
  const restore = mockFetch(async (path, init) => {
    calls.push({ path, init });
    return Response.json(path.includes('/branches') ? { items: [branch], nextCursor: null } : { items: [customer], nextCursor: null });
  });
  try {
    const api = new ControlApi(() => 'operator-access');
    assert.equal((await api.customers()).items[0].id, customer.id);
    assert.equal((await api.branches(customer.id)).items[0].slug, branch.slug);
    assert.equal(calls[0].path, '/api/control/customers?');
    assert.equal(calls[1].path, '/api/control/customers/99c12861-1205-42bf-a6dc-8aff73f88219/branches?');
    for (const { init } of calls) {
      assert.equal(init.headers.Authorization, 'Bearer operator-access');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.cache, 'no-store');
    }
  } finally { restore(); }
});

test('branch creation only accepts typed server response, and sends no patient fields', async () => {
  const restore = mockFetch(async (path, init) => {
    assert.equal(path, '/api/control/customers/99c12861-1205-42bf-a6dc-8aff73f88219/branches');
    assert.deepEqual(JSON.parse(init.body), { slug: branch.slug, branchName: branch.branchName, displayName: branch.displayName });
    return Response.json({ branch, entitlements: { clinicSlug: branch.slug, modules, version: 1 } }, { status: 201 });
  });
  try {
    const result = await new ControlApi(() => 'operator-access').createBranch(customer.id, { slug: branch.slug, branchName: branch.branchName, displayName: branch.displayName });
    assert.equal(result.branch.active, false);
    assert.equal(result.entitlements.modules.billing, false);
  } finally { restore(); }
});

test('legacy clinic inspection and adoption send the exact reviewed snapshot', async () => {
  const legacy = { slug: 'goodwell', displayName: 'Goodwell Clinic', active: true, version: 3 };
  const entitlements = { clinicSlug: 'goodwell', modules: { ...modules, appointments: true }, version: 2 };
  const adopted = { ...legacy, customerId: customer.id, branchName: 'Original' };
  const restore = mockFetch(async (path, init) => {
    if (init.method === 'GET') {
      assert.equal(path, '/api/control/clinics/goodwell');
      return Response.json({ clinic: legacy, entitlements });
    }
    assert.equal(path, '/api/control/customers/99c12861-1205-42bf-a6dc-8aff73f88219/branches/adopt');
    assert.deepEqual(JSON.parse(init.body), {
      slug: 'goodwell', branchName: 'Original', expectedDisplayName: legacy.displayName,
      expectedActive: true, expectedClinicVersion: 3, expectedEntitlementsVersion: 2,
      expectedModules: entitlements.modules,
    });
    return Response.json({ branch: adopted, entitlements });
  });
  try {
    const api = new ControlApi(() => 'operator-access');
    assert.equal((await api.clinic('goodwell')).clinic.customerId, undefined);
    const result = await api.adoptBranch(customer.id, {
      slug: 'goodwell', branchName: 'Original', expectedDisplayName: legacy.displayName,
      expectedActive: true, expectedClinicVersion: 3, expectedEntitlementsVersion: 2,
      expectedModules: entitlements.modules,
    });
    assert.equal(result.branch.customerId, customer.id);
  } finally { restore(); }
});

test('HTML fallback and malformed body cannot become records', async () => {
  let restore = mockFetch(async () => new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } }));
  try { await assert.rejects(new ControlApi(() => 'operator-access').customers(), ControlApiError); }
  finally { restore(); }
  restore = mockFetch(async () => Response.json({ items: [{ ...customer, version: '1' }], nextCursor: null }));
  try { await assert.rejects(new ControlApi(() => 'operator-access').customers(), ControlApiError); }
  finally { restore(); }
});

test('authorization denial stays distinct from a retriable service error', async () => {
  let restore = mockFetch(async () => Response.json({ error: 'Operator access denied' }, { status: 403 }));
  try {
    await assert.rejects(new ControlApi(() => 'operator-access').customers(), (error) => error instanceof ControlApiError && error.status === 403);
  } finally { restore(); }
  restore = mockFetch(async () => new Response('<Error>AccessDenied</Error>', { status: 403, headers: { 'content-type': 'application/xml' } }));
  try {
    await assert.rejects(new ControlApi(() => 'operator-access').customers(), (error) => error instanceof ControlApiError && error.status === null);
  } finally { restore(); }
});

test('OAuth configuration only accepts a secure hosted domain and same-origin callbacks', () => {
  const location = { protocol: 'https:', origin: 'https://staging.example.test', hostname: 'staging.example.test' };
  const valid = { VITE_OPERATOR_AUTH_DOMAIN: 'https://operator.auth.ap-south-1.amazoncognito.com', VITE_OPERATOR_CLIENT_ID: 'abcdef0123456789', VITE_OPERATOR_REDIRECT_URI: 'https://staging.example.test/control/callback', VITE_OPERATOR_LOGOUT_URI: 'https://staging.example.test/control/' };
  assert.ok(configFromEnv(valid, location));
  assert.equal(configFromEnv({ ...valid, VITE_OPERATOR_AUTH_DOMAIN: 'http://operator.example.test' }, location), null);
  assert.equal(configFromEnv({ ...valid, VITE_OPERATOR_REDIRECT_URI: 'https://different.example.test/control/callback' }, location), null);
  assert.equal(configFromEnv({ ...valid, VITE_OPERATOR_CLIENT_ID: '' }, location), null);
  assert.equal(base64url(new Uint8Array([251, 255])), '-_8');
});
