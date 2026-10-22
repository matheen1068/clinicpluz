import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlApp, MODULES } from '../src/core.ts';
import { fromHttpApiEvent } from '../src/http-api.ts';
import { createAuthApp, ROLES as GREEN_ROLES } from '../../clinic-auth-aws/src/core.ts';

const ORIGIN = 'https://example123.cloudfront.net';
const ISSUER = 'https://cognito-idp.ap-south-1.amazonaws.com/operators';
const CLAIMS = { iss: ISSUER, client_id: 'operator-client', token_use: 'access', sub: 'operator-1' };

class MemoryRepository {
  customers = new Map();
  clinics = new Map();
  staff = new Map();
  entitlements = new Map();
  audits = [];
  key(slug, username) { return `${slug}\0${username}`; }
  page(items, after, key) {
    const sorted = items.sort((a, b) => key(a).localeCompare(key(b))).filter((item) => !after || key(item) > after);
    return { items: structuredClone(sorted.slice(0, 20)), nextKey: sorted.length > 20 ? key(sorted[19]) : null };
  }
  async getCustomer(id) { return structuredClone(this.customers.get(id) ?? null); }
  async listCustomers(prefix, after) {
    return this.page([...this.customers.values()].filter((item) => item.displayName.toLowerCase().startsWith(prefix)), after,
      (item) => `NAME#${item.displayName.toLowerCase()}#${item.id}`);
  }
  async createCustomer(customer, audit) {
    if (this.customers.has(customer.id)) return false;
    this.customers.set(customer.id, structuredClone(customer)); this.audits.push(audit); return true;
  }
  async getCustomerBranch(customerId, branchNameKey) {
    return structuredClone([...this.clinics.values()].find((item) => item.customerId === customerId &&
      item.branchName.toLowerCase() === branchNameKey) ?? null);
  }
  async listCustomerBranches(customerId, after) {
    return this.page([...this.clinics.values()].filter((item) => item.customerId === customerId), after,
      (item) => `BRANCH#${item.branchName.toLowerCase()}`);
  }
  async listBranches(prefix, after) {
    return this.page([...this.clinics.values()].filter((item) => item.customerId && item.slug.startsWith(prefix)), after,
      (item) => `SLUG#${item.slug}`);
  }
  async createBranch(branch, modules, audit) {
    if (!this.customers.has(branch.customerId) || this.clinics.has(branch.slug) ||
        [...this.clinics.values()].some((item) => item.customerId === branch.customerId &&
          item.branchName.toLowerCase() === branch.branchName.toLowerCase())) return false;
    this.clinics.set(branch.slug, structuredClone(branch));
    this.entitlements.set(branch.slug, structuredClone(modules));
    this.audits.push(audit); return true;
  }
  async adoptLegacyBranch(branch, modules, audit) {
    const current = this.clinics.get(branch.slug);
    const currentModules = this.entitlements.get(branch.slug);
    if (!this.customers.has(branch.customerId) || !current || current.customerId ||
        current.displayName !== branch.displayName || current.active !== branch.active ||
        current.version !== branch.version || currentModules?.version !== modules.version ||
        [...this.clinics.values()].some((item) => item.customerId === branch.customerId &&
          item.branchName.toLowerCase() === branch.branchName.toLowerCase())) return false;
    this.clinics.set(branch.slug, structuredClone(branch)); this.audits.push(audit); return true;
  }
  async getClinic(slug) { return structuredClone(this.clinics.get(slug) ?? null); }
  async getStaff(slug, username) { return structuredClone(this.staff.get(this.key(slug, username)) ?? null); }
  async listStaff(slug, after) {
    return this.page([...this.staff.values()].filter((item) => item.clinicSlug === slug), after,
      (item) => `STAFF#${item.username}`);
  }
  async getEntitlements(slug) { return structuredClone(this.entitlements.get(slug) ?? null); }
  async listRecentChanges(slug, from, to) {
    const changes = this.audits.filter((event) => event.clinicSlug === slug && event.at >= from && event.at <= to)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    return { items: changes.slice(0, 20).map(({ id, at, action }) => ({ id, at, action })),
      hasMore: changes.length > 20 };
  }
  async createStaff(staff, audit) {
    if (!this.clinics.has(staff.clinicSlug) || this.staff.has(this.key(staff.clinicSlug, staff.username))) return false;
    this.staff.set(this.key(staff.clinicSlug, staff.username), structuredClone(staff));
    this.audits.push(audit);
    return true;
  }
  async replaceStaff(staff, expected, requireInactiveClinic, audit) {
    const key = this.key(staff.clinicSlug, staff.username);
    if (this.staff.get(key)?.version !== expected) return false;
    if (requireInactiveClinic && this.clinics.get(staff.clinicSlug)?.active !== false) return false;
    this.staff.set(key, structuredClone(staff));
    this.audits.push(audit);
    return true;
  }
  async replaceEntitlements(modules, expected, audit) {
    if (this.entitlements.get(modules.clinicSlug)?.version !== expected) return false;
    this.entitlements.set(modules.clinicSlug, structuredClone(modules));
    this.audits.push(audit);
    return true;
  }
  async setClinicState(clinic, expected, adminUsername, audit) {
    if (this.clinics.get(clinic.slug)?.version !== expected) return false;
    if (clinic.active) {
      const admin = this.staff.get(this.key(clinic.slug, adminUsername));
      if (!admin?.active || admin.role !== 'clinic_admin') return false;
    }
    this.clinics.set(clinic.slug, structuredClone(clinic));
    this.audits.push(audit);
    return true;
  }
}
function setup(allowedSubs = ['operator-1']) {
  const repo = new MemoryRepository();
  const identity = { async lookup(username) { return username.startsWith('confirmed-') ? { sub: `sub-${username}` } : null; } };
  const app = createControlApp(repo, identity, {
    publicOrigin: ORIGIN, operatorIssuer: ISSUER, operatorClientId: 'operator-client',
    allowedOperatorSubs: new Set(allowedSubs), cursorSigningKey: 'cursor-secret-for-testing-only-32-characters',
    now: () => new Date('2026-10-08T10:00:00Z'),
  });
  async function call(method, path, payload, claims = CLAIMS, extraHeaders = {}) {
    const url = new URL(path, ORIGIN);
    const result = await app.handle({
      method, path: url.pathname, queryString: url.search.slice(1), verifiedJwtClaims: claims,
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...extraHeaders },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: result.statusCode, body: JSON.parse(result.body), headers: result.headers };
  }
  return { repo, call };
}
async function createCustomerAndBranch(call, slug = 'goodwell', branchName = 'Main', displayName = 'Goodwell Clinic') {
  const customer = await call('POST', '/api/control/customers', { displayName: 'Demo Customer' });
  assert.equal(customer.status, 201);
  const created = await call('POST', `/api/control/customers/${customer.body.customer.id}/branches`,
    { slug, branchName, displayName });
  assert.equal(created.status, 201);
  return { customer: customer.body.customer, branch: created.body.branch };
}

test('operator identity must come from verified JWT authorizer context, never headers', async () => {
  const { repo, call } = setup();
  const request = { displayName: 'Goodwell Customer' };
  assert.equal((await call('POST', '/api/control/customers', request, null, { 'x-operator-sub': 'operator-1' })).status, 403);
  assert.equal((await call('POST', '/api/control/customers', request, { ...CLAIMS, sub: 'other' })).status, 403);
  assert.equal((await call('POST', '/api/control/customers', request, { ...CLAIMS, token_use: 'id' })).status, 403);
  assert.equal((await call('POST', '/api/control/customers', request, { ...CLAIMS, iss: 'https://other.example' })).status, 403);
  assert.equal(repo.audits.length, 0);
  assert.equal(repo.customers.size, 0);
  const mapped = fromHttpApiEvent({ version: '2.0', rawPath: '/api/control/clinics', headers: { 'X-Operator-Sub': 'operator-1' }, requestContext: { http: { method: 'POST' } } });
  assert.equal(mapped.verifiedJwtClaims, undefined);
  assert.equal(fromHttpApiEvent({ version: '2.0', rawPath: '/', headers: { Origin: 'a', origin: 'b' }, requestContext: { http: { method: 'GET' } } }), null);
});

test('a small explicit operator team can act while an unlisted Cognito sub is denied', async () => {
  const { repo, call } = setup(['operator-1', 'operator-2']);
  assert.equal((await call('POST', '/api/control/customers', { displayName: 'First Customer' },
    { ...CLAIMS, sub: 'operator-1' })).status, 201);
  assert.equal((await call('POST', '/api/control/customers', { displayName: 'Second Customer' },
    { ...CLAIMS, sub: 'operator-2' })).status, 201);
  assert.equal((await call('POST', '/api/control/customers', { displayName: 'Denied Customer' },
    { ...CLAIMS, sub: 'operator-3' })).status, 403);
  assert.deepEqual(repo.audits.map((event) => event.actorSub), ['operator-1', 'operator-2']);
  assert.equal(repo.customers.size, 2);
});

test('clinic stays inactive until a verified clinic admin is linked; audit follows each successful mutation', async () => {
  const { repo, call } = setup();
  const { customer, branch } = await createCustomerAndBranch(call);
  assert.equal(branch.active, false);
  assert.ok(MODULES.every((module) => repo.entitlements.get('goodwell').modules[module] === false));
  assert.equal((await call('POST', `/api/control/customers/${customer.id}/branches`,
    { slug: 'goodwell', branchName: 'Duplicate', displayName: 'Duplicate' })).status, 409);
  assert.equal((await call('PATCH', '/api/control/clinics/goodwell/state', { expectedVersion: 1, active: true, adminUsername: 'alice' })).status, 409);
  assert.equal((await call('POST', '/api/control/clinics/goodwell/staff', {
    username: 'alice', cognitoUsername: 'unknown', displayName: 'Alice', role: 'clinic_admin',
  })).status, 409);
  assert.equal((await call('POST', '/api/control/clinics/goodwell/staff', {
    username: 'alice', cognitoUsername: 'confirmed-alice', displayName: 'Alice', role: 'clinic_admin',
  })).status, 201);
  const active = await call('PATCH', '/api/control/clinics/goodwell/state', { expectedVersion: 1, active: true, adminUsername: 'alice' });
  assert.equal(active.status, 200);
  assert.equal(active.body.clinic.version, 2);
  assert.equal(repo.audits.length, 4);
  assert.deepEqual(repo.audits.map((event) => event.action),
    ['customer.created', 'branch.created', 'staff.created', 'clinic.state_changed']);
  assert.ok(repo.audits.every((event) => event.actorSub === 'operator-1'));
  assert.ok(repo.audits.slice(1).every((event) => event.clinicSlug === 'goodwell'));
});

test('per-clinic staff and module changes stay keyed to the chosen clinic with version guards', async () => {
  const { repo, call } = setup();
  await createCustomerAndBranch(call, 'goodwell', 'Main', 'Goodwell');
  await createCustomerAndBranch(call, 'blesswell', 'Main', 'Blesswell');
  await call('POST', '/api/control/clinics/goodwell/staff', {
    username: 'alice', cognitoUsername: 'confirmed-alice', displayName: 'Alice', role: 'clinic_admin',
  });
  assert.equal((await call('GET', '/api/control/clinics/blesswell/staff/alice')).status, 404);
  assert.equal((await call('PATCH', '/api/control/clinics/blesswell/staff/alice', {
    expectedVersion: 1, displayName: 'Alice', role: 'doctor', active: false,
  })).status, 404);
  assert.equal(repo.staff.get(repo.key('goodwell', 'alice')).active, true);
  const changed = await call('PATCH', '/api/control/clinics/goodwell/staff/alice', {
    expectedVersion: 1, displayName: 'Alice', role: 'clinic_admin', active: false,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.staff.active, false);
  assert.equal((await call('PATCH', '/api/control/clinics/goodwell/staff/alice', {
    expectedVersion: 1, displayName: 'Alice', role: 'doctor', active: true,
  })).status, 409);
  const allFalse = Object.fromEntries(MODULES.map((name) => [name, false]));
  const modules = { ...allFalse, patient_intake: true, appointments: true };
  assert.equal((await call('PUT', '/api/control/clinics/goodwell/modules', { expectedVersion: 1, modules })).status, 200);
  assert.equal((await call('PUT', '/api/control/clinics/goodwell/modules', { expectedVersion: 1, modules })).status, 409);
  assert.equal((await call('PUT', '/api/control/clinics/goodwell/modules', {
    expectedVersion: 2, modules: { ...modules, unknown_module: true },
  })).status, 400);
  assert.equal(repo.entitlements.get('blesswell').modules.patient_intake, false);
  assert.equal(repo.entitlements.get('goodwell').modules.patient_intake, true);
  assert.equal(repo.audits.length, 7);
});

test('state-changing calls require exact same-origin request; malformed input fails closed', async () => {
  const { repo, call } = setup();
  assert.equal((await call('POST', '/api/control/customers', { displayName: 'Goodwell' }, CLAIMS,
    { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/api/control/customers', { displayName: 'Goodwell', active: true })).status, 400);
  const customer = await call('POST', '/api/control/customers', { displayName: 'Goodwell' });
  assert.equal((await call('POST', `/api/control/customers/${customer.body.customer.id}/branches`,
    { slug: 'admin', branchName: 'Main', displayName: 'Goodwell' })).status, 400);
  assert.equal(repo.clinics.size, 0);
});

test('customers own multiple branches; names are unique within a customer and slugs globally', async () => {
  const { repo, call } = setup();
  const first = await createCustomerAndBranch(call, 'goodwell-main', 'Main', 'Goodwell Main');
  const second = await call('POST', `/api/control/customers/${first.customer.id}/branches`,
    { slug: 'goodwell-east', branchName: 'East', displayName: 'Goodwell East' });
  assert.equal(second.status, 201);
  assert.equal((await call('POST', `/api/control/customers/${first.customer.id}/branches`,
    { slug: 'goodwell-other', branchName: '  MAIN  ', displayName: 'Duplicate' })).status, 409);
  const other = await createCustomerAndBranch(call, 'blesswell-main', 'Main', 'Blesswell Main');
  assert.equal((await call('POST', `/api/control/customers/${other.customer.id}/branches`,
    { slug: 'goodwell-east', branchName: 'North', displayName: 'Duplicate slug' })).status, 409);
  assert.equal((await call('GET', `/api/control/customers/${first.customer.id}/branches/goodwell-east`)).status, 200);
  assert.equal((await call('GET', `/api/control/customers/${other.customer.id}/branches/goodwell-east`)).status, 404);
  const owned = await call('GET', `/api/control/customers/${first.customer.id}/branches`);
  assert.deepEqual(owned.body.items.map((branch) => branch.slug), ['goodwell-east', 'goodwell-main']);
  assert.equal((await call('GET', '/api/control/branches?prefix=goodwell')).body.items.length, 2);
  assert.equal((await call('GET', '/api/control/branches/goodwell-east')).body.branch.customerId, first.customer.id);
  assert.equal(repo.entitlements.get('goodwell-main').modules.appointments, false);
  assert.equal(repo.clinics.get('goodwell-east').active, false);
});

test('branch detail fails closed when directory metadata disagrees with the canonical clinic', async () => {
  const { repo, call } = setup();
  const { customer } = await createCustomerAndBranch(call);
  let diagnosticReads = 0;
  repo.listRecentChanges = async () => { diagnosticReads++; return { items: [], hasMore: false }; };
  const getCustomerBranch = repo.getCustomerBranch.bind(repo);
  repo.getCustomerBranch = async (...args) => {
    const indexed = await getCustomerBranch(...args);
    return indexed && { ...indexed, active: true };
  };
  assert.equal((await call('GET', `/api/control/customers/${customer.id}/branches/goodwell`)).status, 503);
  assert.equal((await call('GET', '/api/control/branches/goodwell')).status, 503);
  assert.equal((await call('GET', '/api/control/branches/goodwell/diagnostics')).status, 503);
  assert.equal(diagnosticReads, 0);
});

test('diagnostics show bounded branch setup and sanitized audit changes without invented telemetry', async () => {
  const { repo, call } = setup();
  const first = await createCustomerAndBranch(call, 'goodwell', 'Main');
  await createCustomerAndBranch(call, 'blesswell', 'Main');
  await call('POST', '/api/control/clinics/goodwell/staff', {
    username: 'alice', cognitoUsername: 'confirmed-alice', displayName: 'Alice', role: 'clinic_admin',
  });
  repo.audits.push({ id: '11111111-1111-4111-8111-111111111111', clinicSlug: 'goodwell',
    actorSub: 'private-operator', action: 'modules.replaced', target: 'private-target',
    at: '2026-10-07T10:00:00.000Z', changes: { privateNote: 'never expose' } });
  repo.audits.push({ id: '22222222-2222-4222-8222-222222222222', clinicSlug: 'goodwell',
    actorSub: 'private-operator', action: 'staff.updated', target: 'private-target',
    at: '2026-09-01T10:00:00.000Z', changes: { privateNote: 'never expose' } });
  const result = await call('GET', '/api/control/branches/goodwell/diagnostics');
  assert.equal(result.status, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.body.branch.customerId, first.customer.id);
  assert.equal(result.body.checkedAt, '2026-10-08T10:00:00.000Z');
  assert.deepEqual(result.body.configuration.entitlements,
    { state: 'present', version: 1, enabledModules: [] });
  assert.deepEqual(result.body.configuration.staff,
    { sampledCount: 1, hasMore: false, activeAdmin: 'present' });
  assert.equal(result.body.recentChanges.from, '2026-10-01T10:00:00.000Z');
  assert.equal(result.body.recentChanges.to, result.body.checkedAt);
  assert.equal(result.body.recentChanges.hasMore, false);
  assert.ok(result.body.recentChanges.items.some((item) => item.action === 'modules.replaced'));
  assert.ok(result.body.recentChanges.items.every((item) =>
    Object.keys(item).sort().join(',') === 'action,at,id'));
  assert.deepEqual(Object.values(result.body.telemetry), [
    { state: 'not_instrumented' }, { state: 'not_instrumented' }, { state: 'not_instrumented' },
  ]);
  assert.equal(JSON.stringify(result.body).includes('private-'), false);
  assert.equal(JSON.stringify(result.body).includes('never expose'), false);
  assert.equal((await call('GET', '/api/control/branches/blesswell/diagnostics')).body.recentChanges.items
    .some((item) => item.action === 'modules.replaced'), false);
  assert.equal((await call('GET', '/api/control/branches/unknown/diagnostics')).status, 404);
  assert.equal((await call('GET', '/api/control/branches/goodwell/diagnostics?window=all')).status, 400);
  assert.equal((await call('GET', '/api/control/branches/goodwell/diagnostics', undefined,
    { ...CLAIMS, sub: 'not-allowlisted' })).status, 403);
});

test('diagnostics report missing setup and unknown admin when bounded staff sample has more pages', async () => {
  const { repo, call } = setup();
  await createCustomerAndBranch(call);
  repo.entitlements.delete('goodwell');
  for (let index = 0; index < 21; index++) {
    const username = `staff-${String(index).padStart(2, '0')}`;
    repo.staff.set(repo.key('goodwell', username), { clinicSlug: 'goodwell', username,
      cognitoUsername: username, sub: username, displayName: username,
      role: index === 20 ? 'clinic_admin' : 'receptionist', active: true, version: 1 });
  }
  const result = await call('GET', '/api/control/branches/goodwell/diagnostics');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.configuration.entitlements,
    { state: 'missing', version: null, enabledModules: [] });
  assert.deepEqual(result.body.configuration.staff,
    { sampledCount: 20, hasMore: true, activeAdmin: 'unknown' });
  repo.staff.delete(repo.key('goodwell', 'staff-20'));
  const complete = await call('GET', '/api/control/branches/goodwell/diagnostics');
  assert.deepEqual(complete.body.configuration.staff,
    { sampledCount: 20, hasMore: false, activeAdmin: 'missing' });
});

test('customer, branch and staff directories paginate with scoped signed cursors', async () => {
  const { call } = setup();
  const customer = (await createCustomerAndBranch(call, 'pilot-00', 'Branch 00')).customer;
  for (let index = 1; index <= 21; index++) {
    const name = `Branch ${String(index).padStart(2, '0')}`;
    assert.equal((await call('POST', `/api/control/customers/${customer.id}/branches`,
      { slug: `pilot-${String(index).padStart(2, '0')}`, branchName: name, displayName: name })).status, 201);
  }
  const first = await call('GET', `/api/control/customers/${customer.id}/branches`);
  assert.equal(first.body.items.length, 20);
  assert.ok(first.body.nextCursor);
  const next = await call('GET', `/api/control/customers/${customer.id}/branches?cursor=${first.body.nextCursor}`);
  assert.equal(next.body.items.length, 2);
  assert.equal(next.body.nextCursor, null);
  assert.equal((await call('GET', `/api/control/customers/${customer.id}/branches?cursor=${first.body.nextCursor}x`)).status, 400);
  assert.equal((await call('GET', `/api/control/branches?cursor=${first.body.nextCursor}`)).status, 400);
  const other = (await createCustomerAndBranch(call, 'other-main')).customer;
  assert.equal((await call('GET', `/api/control/customers/${other.id}/branches?cursor=${first.body.nextCursor}`)).status, 400);
  const global = await call('GET', '/api/control/branches?prefix=pilot');
  assert.equal(global.body.items.length, 20);
  assert.equal((await call('GET', `/api/control/branches?prefix=other&cursor=${global.body.nextCursor}`)).status, 400);
  assert.equal((await call('GET', '/api/control/customers?prefix=Demo')).body.items.length, 2);
  await call('POST', '/api/control/clinics/pilot-00/staff', {
    username: 'alice', cognitoUsername: 'confirmed-alice', displayName: 'Alice', role: 'clinic_admin',
  });
  assert.deepEqual((await call('GET', '/api/control/clinics/pilot-00/staff')).body.items.map((staff) => staff.username), ['alice']);
  assert.deepEqual((await call('GET', '/api/control/clinics/pilot-01/staff')).body.items, []);
});

test('pharmacist membership is permitted and module dependencies follow actual route gates', async () => {
  const { call } = setup();
  await createCustomerAndBranch(call);
  assert.equal((await call('POST', '/api/control/clinics/goodwell/staff', {
    username: 'pharmacy', cognitoUsername: 'confirmed-pharmacy', displayName: 'Demo Pharmacist', role: 'pharmacist',
  })).status, 201);
  const allFalse = Object.fromEntries(MODULES.map((name) => [name, false]));
  assert.equal((await call('PUT', '/api/control/clinics/goodwell/modules', {
    expectedVersion: 1, modules: { ...allFalse, vitals: true },
  })).status, 400);
  assert.equal((await call('PUT', '/api/control/clinics/goodwell/modules', {
    expectedVersion: 1, modules: { ...allFalse, prescriptions: true },
  })).status, 400);
  assert.equal((await call('PUT', '/api/control/clinics/goodwell/modules', {
    expectedVersion: 1, modules: { ...allFalse, billing: true },
  })).status, 200);
});

test('legacy clinic adoption requires an exact reviewed snapshot and preserves staff, state, slug and enabled modules', async () => {
  const { repo, call } = setup();
  const customer = (await call('POST', '/api/control/customers', { displayName: 'Goodwell Group' })).body.customer;
  const other = (await call('POST', '/api/control/customers', { displayName: 'Other Group' })).body.customer;
  const modules = { ...Object.fromEntries(MODULES.map((name) => [name, false])),
    patient_intake: true, appointments: true, consultations: true, billing: true };
  repo.clinics.set('goodwell', { slug: 'goodwell', displayName: 'Goodwell Clinic', active: true, version: 1 });
  repo.entitlements.set('goodwell', { clinicSlug: 'goodwell', modules: structuredClone(modules), version: 1 });
  repo.staff.set(repo.key('goodwell', 'alice'), { clinicSlug: 'goodwell', username: 'alice',
    cognitoUsername: 'confirmed-alice', sub: 'sub-confirmed-alice', displayName: 'Alice',
    role: 'clinic_admin', active: true, version: 1 });
  const snapshot = { slug: 'goodwell', branchName: 'Main', expectedDisplayName: 'Goodwell Clinic',
    expectedActive: true, expectedClinicVersion: 1, expectedEntitlementsVersion: 1, expectedModules: modules };
  const path = `/api/control/customers/${customer.id}/branches/adopt`;
  assert.equal((await call('POST', path, { ...snapshot, expectedActive: false })).status, 409);
  assert.equal((await call('POST', path, { ...snapshot,
    expectedModules: { ...modules, billing: false } })).status, 409);
  assert.equal((await call('POST', path, snapshot)).status, 200);
  assert.equal(repo.clinics.get('goodwell').active, true);
  assert.equal(repo.clinics.get('goodwell').slug, 'goodwell');
  assert.equal(repo.staff.get(repo.key('goodwell', 'alice')).active, true);
  assert.deepEqual(repo.entitlements.get('goodwell').modules, modules);
  assert.equal((await call('POST', path, snapshot)).status, 409);
  assert.equal((await call('GET', `/api/control/customers/${other.id}/branches/goodwell`)).status, 404);
  assert.equal((await call('GET', `/api/control/customers/${customer.id}/branches/goodwell`)).body.branch.customerId, customer.id);
  assert.equal(repo.audits.filter((event) => event.action === 'branch.legacy_adopted').length, 1);
});

test('an active clinic admin cannot be suspended until the clinic is disabled', async () => {
  const { repo, call } = setup();
  await createCustomerAndBranch(call);
  await call('POST', '/api/control/clinics/goodwell/staff', {
    username: 'alice', cognitoUsername: 'confirmed-alice', displayName: 'Alice', role: 'clinic_admin',
  });
  await call('PATCH', '/api/control/clinics/goodwell/state', { expectedVersion: 1, active: true, adminUsername: 'alice' });
  const auditCount = repo.audits.length;
  assert.equal((await call('PATCH', '/api/control/clinics/goodwell/staff/alice', {
    expectedVersion: 1, displayName: 'Alice', role: 'clinic_admin', active: false,
  })).status, 409);
  assert.equal(repo.staff.get(repo.key('goodwell', 'alice')).active, true);
  assert.equal(repo.audits.length, auditCount);
  assert.equal((await call('PATCH', '/api/control/clinics/goodwell/state', {
    expectedVersion: 2, active: false, adminUsername: null,
  })).status, 200);
  assert.equal((await call('PATCH', '/api/control/clinics/goodwell/staff/alice', {
    expectedVersion: 1, displayName: 'Alice', role: 'clinic_admin', active: false,
  })).status, 200);
});

test('Control Panel memberships feed Green login and staff suspension revokes an existing clinic session', async () => {
  assert.equal(GREEN_ROLES.has('pharmacist'), false); // This older auth checkout must be upgraded before pharmacist onboarding.
  const { repo, call } = setup();
  await createCustomerAndBranch(call);
  await call('POST', '/api/control/clinics/goodwell/staff', {
    username: 'alice', cognitoUsername: 'confirmed-alice', displayName: 'Alice', role: 'clinic_admin',
  });
  await call('POST', '/api/control/clinics/goodwell/staff', {
    username: 'bob', cognitoUsername: 'confirmed-bob', displayName: 'Bob', role: 'receptionist',
  });
  await call('PATCH', '/api/control/clinics/goodwell/state', { expectedVersion: 1, active: true, adminUsername: 'alice' });
  const pres = new Map();
  const sessions = new Map();
  const greenRepo = {
    getClinic: (slug) => repo.getClinic(slug),
    getMembership: (slug, username) => repo.getStaff(slug, username),
    async getPre(hash) { return pres.get(hash) ?? null; },
    async putPre(hash, value) { pres.set(hash, value); },
    async createSessionConsumePre(preHash, sessionHash, value) {
      if (!pres.has(preHash)) return false;
      pres.delete(preHash); sessions.set(sessionHash, value); return true;
    },
    async getSession(hash) { return sessions.get(hash) ?? null; },
    async deleteSession(hash) { sessions.delete(hash); },
    async getFailureCount() { return 0; },
    async recordFailure() {},
  };
  const greenIdentity = {
    async authenticate(username, password) {
      return username === 'confirmed-bob' && password === 'correct'
        ? { kind: 'authenticated', sub: 'sub-confirmed-bob' }
        : { kind: 'challenge' };
    },
    async isActive() { return true; },
  };
  const edgeKey = 'a'.repeat(48);
  const green = createAuthApp(greenRepo, greenIdentity, {
    publicOrigin: ORIGIN, edgeKey, now: () => Date.parse('2026-10-08T10:00:00Z'),
  });
  const base = '/api/clinics/goodwell';
  const bootstrap = await green.handle({ method: 'GET', path: `${base}/bootstrap`, headers: { 'x-clinicpluz-edge-key': edgeKey } });
  assert.equal(bootstrap.statusCode, 200);
  const preCookie = bootstrap.cookies[0].split(';')[0];
  const login = await green.handle({ method: 'POST', path: `${base}/auth/login`,
    headers: { 'x-clinicpluz-edge-key': edgeKey, origin: ORIGIN,
      'x-csrf-token': JSON.parse(bootstrap.body).csrfToken, 'content-type': 'application/json' },
    cookies: [preCookie], body: JSON.stringify({ username: 'bob', password: 'correct' }) });
  assert.equal(login.statusCode, 200);
  const sessionCookie = login.cookies.find((cookie) => cookie.startsWith('__Host-cpz_session=')).split(';')[0];
  const session = () => green.handle({ method: 'GET', path: `${base}/auth/session`,
    headers: { 'x-clinicpluz-edge-key': edgeKey }, cookies: [sessionCookie] });
  assert.equal((await session()).statusCode, 200);
  assert.equal((await call('PATCH', '/api/control/clinics/goodwell/staff/bob', {
    expectedVersion: 1, displayName: 'Bob', role: 'receptionist', active: false,
  })).status, 200);
  assert.equal((await session()).statusCode, 401);
});
