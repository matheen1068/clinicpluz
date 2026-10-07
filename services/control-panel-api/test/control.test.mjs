import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlApp, MODULES } from '../src/core.ts';
import { fromHttpApiEvent } from '../src/http-api.ts';
import { createAuthApp, ROLES as GREEN_ROLES } from '../../clinic-auth-aws/src/core.ts';

const ORIGIN = 'https://example123.cloudfront.net';
const ISSUER = 'https://cognito-idp.ap-south-1.amazonaws.com/operators';
const CLAIMS = { iss: ISSUER, client_id: 'operator-client', token_use: 'access', sub: 'operator-1' };

class MemoryRepository {
  clinics = new Map();
  staff = new Map();
  entitlements = new Map();
  audits = [];
  key(slug, username) { return `${slug}\0${username}`; }
  async getClinic(slug) { return structuredClone(this.clinics.get(slug) ?? null); }
  async getStaff(slug, username) { return structuredClone(this.staff.get(this.key(slug, username)) ?? null); }
  async getEntitlements(slug) { return structuredClone(this.entitlements.get(slug) ?? null); }
  async createClinic(clinic, modules, audit) {
    if (this.clinics.has(clinic.slug)) return false;
    this.clinics.set(clinic.slug, structuredClone(clinic));
    this.entitlements.set(clinic.slug, structuredClone(modules));
    this.audits.push(audit);
    return true;
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
function setup() {
  const repo = new MemoryRepository();
  const identity = { async lookup(username) { return username.startsWith('confirmed-') ? { sub: `sub-${username}` } : null; } };
  const app = createControlApp(repo, identity, {
    publicOrigin: ORIGIN, operatorIssuer: ISSUER, operatorClientId: 'operator-client',
    allowedOperatorSubs: new Set(['operator-1']), now: () => new Date('2026-10-08T10:00:00Z'),
  });
  async function call(method, path, payload, claims = CLAIMS, extraHeaders = {}) {
    const result = await app.handle({
      method, path, verifiedJwtClaims: claims,
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...extraHeaders },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: result.statusCode, body: JSON.parse(result.body), headers: result.headers };
  }
  return { repo, call };
}

test('operator identity must come from verified JWT authorizer context, never headers', async () => {
  const { repo, call } = setup();
  const request = { slug: 'goodwell', displayName: 'Goodwell Clinic' };
  assert.equal((await call('POST', '/api/control/clinics', request, null, { 'x-operator-sub': 'operator-1' })).status, 403);
  assert.equal((await call('POST', '/api/control/clinics', request, { ...CLAIMS, sub: 'other' })).status, 403);
  assert.equal((await call('POST', '/api/control/clinics', request, { ...CLAIMS, token_use: 'id' })).status, 403);
  assert.equal((await call('POST', '/api/control/clinics', request, { ...CLAIMS, iss: 'https://other.example' })).status, 403);
  assert.equal(repo.audits.length, 0);
  assert.equal(repo.clinics.size, 0);
  const mapped = fromHttpApiEvent({ version: '2.0', rawPath: '/api/control/clinics', headers: { 'X-Operator-Sub': 'operator-1' }, requestContext: { http: { method: 'POST' } } });
  assert.equal(mapped.verifiedJwtClaims, undefined);
  assert.equal(fromHttpApiEvent({ version: '2.0', rawPath: '/', headers: { Origin: 'a', origin: 'b' }, requestContext: { http: { method: 'GET' } } }), null);
});

test('clinic stays inactive until a verified clinic admin is linked; audit follows each successful mutation', async () => {
  const { repo, call } = setup();
  const created = await call('POST', '/api/control/clinics', { slug: 'goodwell', displayName: 'Goodwell Clinic' });
  assert.equal(created.status, 201);
  assert.equal(created.body.clinic.active, false);
  assert.ok(MODULES.every((module) => created.body.entitlements.modules[module] === false));
  assert.equal((await call('POST', '/api/control/clinics', { slug: 'goodwell', displayName: 'Duplicate' })).status, 409);
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
  assert.equal(repo.audits.length, 3);
  assert.deepEqual(repo.audits.map((event) => event.action), ['clinic.created', 'staff.created', 'clinic.state_changed']);
  assert.ok(repo.audits.every((event) => event.actorSub === 'operator-1' && event.clinicSlug === 'goodwell'));
});

test('per-clinic staff and module changes stay keyed to the chosen clinic with version guards', async () => {
  const { repo, call } = setup();
  await call('POST', '/api/control/clinics', { slug: 'goodwell', displayName: 'Goodwell' });
  await call('POST', '/api/control/clinics', { slug: 'blesswell', displayName: 'Blesswell' });
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
  assert.equal(repo.audits.length, 5);
});

test('state-changing calls require exact same-origin request; malformed input fails closed', async () => {
  const { repo, call } = setup();
  assert.equal((await call('POST', '/api/control/clinics', { slug: 'goodwell', displayName: 'Goodwell' }, CLAIMS,
    { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/api/control/clinics', { slug: 'admin', displayName: 'Reserved' })).status, 400);
  assert.equal((await call('POST', '/api/control/clinics', { slug: 'goodwell', displayName: 'Goodwell', active: true })).status, 400);
  assert.equal(repo.clinics.size, 0);
});

test('an active clinic admin cannot be suspended until the clinic is disabled', async () => {
  const { repo, call } = setup();
  await call('POST', '/api/control/clinics', { slug: 'goodwell', displayName: 'Goodwell' });
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
  assert.deepEqual([...GREEN_ROLES].sort(), ['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing'].sort());
  const { repo, call } = setup();
  await call('POST', '/api/control/clinics', { slug: 'goodwell', displayName: 'Goodwell' });
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
