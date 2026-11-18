import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createAuthApp, IdentityError } from '../src/core.ts';
import { fromHttpApiEvent } from '../src/http-api.ts';

const ORIGIN = 'https://dpq5w4kpcyvb4.cloudfront.net';
const EDGE_KEY = randomBytes(48).toString('base64url');
const now = 1_800_000_000_000;

class FakeRepo {
  clinics = new Map([
    ['goodwell', { slug: 'goodwell', displayName: 'Goodwell Clinic', active: true }],
    ['blesswell', { slug: 'blesswell', displayName: 'Blesswell Clinic', active: true }],
  ]);
  members = new Map();
  pre = new Map();
  sessions = new Map();
  failures = new Map();
  constructor() {
    for (const slug of this.clinics.keys()) {
      this.members.set(`${slug}:reception`, {
        clinicSlug: slug, username: 'reception', cognitoUsername: `${slug}-staff`,
        sub: `${slug}-sub`, displayName: `${slug} Reception`, role: 'receptionist', active: true,
      });
    }
  }
  async getClinic(slug) { return this.clinics.get(slug) ?? null; }
  async getMembership(slug, username) { return this.members.get(`${slug}:${username}`) ?? null; }
  async getPre(hash) { return this.pre.get(hash) ?? null; }
  async putPre(hash, pre) { this.pre.set(hash, pre); }
  async createSessionConsumePre(preHash, sessionHash, session, at) {
    const pre = this.pre.get(preHash);
    if (!pre || pre.expiresAt <= at || pre.clinicSlug !== session.clinicSlug || this.sessions.has(sessionHash)) return false;
    this.pre.delete(preHash);
    this.sessions.set(sessionHash, session);
    return true;
  }
  async getSession(hash) { return this.sessions.get(hash) ?? null; }
  async deleteSession(hash) { this.sessions.delete(hash); }
  async getFailureCount(slug, username, window) { return this.failures.get(`${slug}:${username}:${window}`) ?? 0; }
  async recordFailure(slug, username, window) {
    const key = `${slug}:${username}:${window}`;
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
  }
}

function harness() {
  const repo = new FakeRepo();
  let password = randomBytes(24).toString('base64url');
  let pending = false;
  const resets = [];
  let clock = now;
  let challenge = false;
  let enabled = true;
  const identity = {
    async authenticate(cognitoUsername, suppliedPassword) {
      if (suppliedPassword !== password) throw new IdentityError('invalid-credentials');
      if (pending) return { kind: 'new-password-required' };
      if (challenge) return { kind: 'challenge' };
      return { kind: 'authenticated', sub: cognitoUsername.replace('-staff', '-sub') };
    },
    async isActive(cognitoUsername, sub) {
      return enabled && cognitoUsername.replace('-staff', '-sub') === sub;
    },
    async completeNewPassword(cognitoUsername, temp, next) {
      if (temp !== password) throw new IdentityError('invalid-credentials');
      if (!pending) throw new IdentityError('not-pending');
      if (!/[A-Z]/.test(next)) throw new IdentityError('weak-password');
      pending = false; password = next;
      return { sub: cognitoUsername.replace('-staff', '-sub') };
    },
    async startReset(cognitoUsername) { resets.push(cognitoUsername); },
    async confirmReset(cognitoUsername, code, next) {
      if (code !== '123456') throw new IdentityError('invalid-code');
      if (!/[A-Z]/.test(next)) throw new IdentityError('weak-password');
      password = next;
    },
  };
  const app = createAuthApp(repo, identity, { publicOrigin: ORIGIN, edgeKey: EDGE_KEY, now: () => clock });
  const jars = new Map();
  async function request(slug, endpoint, { method = 'GET', body, origin = ORIGIN, edgeKey = EDGE_KEY, cookieKey = 'shared', headers = {}, cookies } = {}) {
    const storedCookies = jars.get(cookieKey) ?? new Map();
    const joined = [...storedCookies].map(([key, value]) => `${key}=${value}`).join('; ');
    const result = await app.handle({
      method, path: `/api/clinics/${slug}/${endpoint}`,
      headers: {
        'x-clinicpluz-edge-key': edgeKey,
        ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
        ...(joined ? { cookie: joined } : {}), ...headers,
      }, body: body && JSON.stringify(body), cookies,
    });
    for (const set of result.cookies ?? []) {
      const [name, value] = set.split(';', 1)[0].split('=');
      if (value) storedCookies.set(name, value);
      else storedCookies.delete(name);
    }
    jars.set(cookieKey, storedCookies);
    return result;
  }
  async function bootstrap(slug, cookieKey) {
    const result = await request(slug, 'bootstrap', { cookieKey });
    assert.equal(result.statusCode, 200);
    return JSON.parse(result.body).csrfToken;
  }
  async function login(slug, csrfToken, cookieKey, supplied = password) {
    return request(slug, 'auth/login', {
      method: 'POST', cookieKey, headers: { 'x-csrf-token': csrfToken },
      body: { username: 'reception', password: supplied },
    });
  }
  return { repo, jars, get password() { return password; }, resets, setPending: (value) => { pending = value; }, request, bootstrap, login, setTime: (value) => { clock = value; }, setChallenge: (value) => { challenge = value; }, setEnabled: (value) => { enabled = value; } };
}

test('two clinic paths require separate membership; shared-host session cannot change clinics', async () => {
  const h = harness();
  const csrfA = await h.bootstrap('goodwell');
  const signedIn = await h.login('goodwell', csrfA);
  assert.equal(signedIn.statusCode, 200);
  assert.equal(JSON.parse(signedIn.body).clinicSlug, 'goodwell');
  assert.match(signedIn.cookies[1], /^__Host-cpz_session=.*Secure; HttpOnly; SameSite=Lax/);
  assert.ok(!signedIn.cookies[1].includes('Domain='));
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 200);
  const sessionCookie = [...h.jars.get('shared')].find(([name]) => name === '__Host-cpz_session');
  assert.equal((await h.request('goodwell', 'auth/session', { cookies: [`${sessionCookie[0]}=${sessionCookie[1]}`] })).statusCode, 200);
  assert.equal((await h.request('goodwell', 'auth/session', { cookies: [`${sessionCookie[0]}=${sessionCookie[1]}`, `${sessionCookie[0]}=${sessionCookie[1]}`] })).statusCode, 401);
  assert.equal((await h.request('blesswell', 'auth/session')).statusCode, 403);
  const csrfB = await h.bootstrap('blesswell');
  assert.equal((await h.login('blesswell', csrfB)).statusCode, 403);
  const logoutCsrf = JSON.parse(signedIn.body).csrfToken;
  assert.equal((await h.request('goodwell', 'auth/logout', { method: 'POST', headers: { 'x-csrf-token': 'wrong' } })).statusCode, 403);
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 200);
  assert.equal((await h.request('goodwell', 'auth/logout', { method: 'POST', headers: { 'x-csrf-token': logoutCsrf } })).statusCode, 204);
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 401);
  assert.equal((await h.login('blesswell', csrfB)).statusCode, 200);
  assert.equal((await h.request('blesswell', 'auth/session')).statusCode, 200);
});

test('origin, edge marker, CSRF, malformed cookies and bad credentials fail closed', async () => {
  const h = harness();
  assert.equal((await h.request('goodwell', 'bootstrap', { edgeKey: 'wrong' })).statusCode, 403);
  const csrf = await h.bootstrap('goodwell');
  assert.equal((await h.request('goodwell', 'auth/login', { method: 'POST', origin: 'https://evil.example', body: { username: 'reception', password: h.password }, headers: { 'x-csrf-token': csrf } })).statusCode, 403);
  assert.equal((await h.login('goodwell', 'wrong')).statusCode, 403);
  const wrong = randomBytes(24).toString('base64url');
  assert.equal((await h.login('goodwell', csrf, 'shared', wrong)).statusCode, 401);
  assert.equal((await h.request('goodwell', 'auth/session', { headers: { cookie: '__Host-cpz_session=abc; __Host-cpz_session=def' } })).statusCode, 401);
  assert.equal((await h.request('goodwell', 'auth/session', { cookies: ['__Host-cpz_session=abc'] })).statusCode, 401);
  assert.equal((await h.request('goodwell', 'auth/session', { cookies: ['__Host-cpz_session=abc', '__Host-cpz_session=def'] })).statusCode, 401);
  assert.equal((await h.request('unknown', 'bootstrap')).statusCode, 404);
});

test('five failed logins throttle the clinic username for the current window', async () => {
  const h = harness();
  const csrf = await h.bootstrap('goodwell');
  const wrong = randomBytes(24).toString('base64url');
  for (let index = 0; index < 5; index++) assert.equal((await h.login('goodwell', csrf, 'shared', wrong)).statusCode, 401);
  assert.equal((await h.login('goodwell', csrf)).statusCode, 429);
  h.setTime(now + 15 * 60_000);
  assert.equal((await h.login('goodwell', csrf)).statusCode, 403); // pre-login CSRF expired
  const freshCsrf = await h.bootstrap('goodwell');
  assert.equal((await h.login('goodwell', freshCsrf)).statusCode, 200);
});

test('Cognito challenge, disabled clinic and disabled staff never create usable sessions', async () => {
  const h = harness();
  const csrf = await h.bootstrap('goodwell');
  h.setChallenge(true);
  assert.equal((await h.login('goodwell', csrf)).statusCode, 403);
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 401);
  h.setChallenge(false);
  assert.equal((await h.login('goodwell', csrf)).statusCode, 200);
  h.repo.members.get('goodwell:reception').active = false;
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 401);
  h.repo.members.get('goodwell:reception').active = true;
  const second = await h.bootstrap('goodwell');
  assert.equal((await h.login('goodwell', second)).statusCode, 200);
  h.setEnabled(false);
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 401);
  h.repo.clinics.get('goodwell').active = false;
  assert.equal((await h.request('goodwell', 'bootstrap')).statusCode, 404);
});

test('a Cognito identity with the wrong stable sub cannot acquire clinic membership', async () => {
  const h = harness();
  const csrf = await h.bootstrap('goodwell');
  h.repo.members.get('goodwell:reception').sub = 'a-different-person';
  assert.equal((await h.login('goodwell', csrf)).statusCode, 403);
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 401);
});

test('pharmacist receives only their own clinic role and loses the session when disabled', async () => {
  const h = harness();
  h.repo.members.set('goodwell:pharmacy', {
    clinicSlug: 'goodwell', username: 'pharmacy', cognitoUsername: 'goodwell-pharmacy-staff',
    sub: 'goodwell-pharmacy-sub', displayName: 'Goodwell Pharmacy', role: 'pharmacist', active: true,
  });
  const csrf = await h.bootstrap('goodwell');
  const signedIn = await h.request('goodwell', 'auth/login', {
    method: 'POST', headers: { 'x-csrf-token': csrf },
    body: { username: 'pharmacy', password: h.password },
  });
  assert.equal(signedIn.statusCode, 200);
  assert.equal(JSON.parse(signedIn.body).user.role, 'pharmacist');
  assert.equal(JSON.parse((await h.request('goodwell', 'auth/session')).body).user.role, 'pharmacist');
  assert.equal((await h.request('blesswell', 'auth/session')).statusCode, 403);
  h.repo.members.get('goodwell:pharmacy').active = false;
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 401);
});

test('expired sessions are rejected even if DynamoDB TTL has not removed the item', async () => {
  const h = harness();
  const csrf = await h.bootstrap('goodwell');
  assert.equal((await h.login('goodwell', csrf)).statusCode, 200);
  h.setTime(now + 60 * 60_000 + 1);
  assert.equal((await h.request('goodwell', 'auth/session')).statusCode, 401);
});

test('HTTP API v2 adapter preserves path, cookies and lowercases headers', () => {
  const result = fromHttpApiEvent({
    version: '2.0', rawPath: '/api/clinics/goodwell/bootstrap',
    headers: { 'X-ClinicPluz-Edge-Key': EDGE_KEY }, cookies: ['one=two'],
    requestContext: { http: { method: 'GET' } },
  });
  assert.equal(result.path, '/api/clinics/goodwell/bootstrap');
  assert.equal(result.headers['x-clinicpluz-edge-key'], EDGE_KEY);
  assert.deepEqual(result.cookies, ['one=two']);
  assert.equal(fromHttpApiEvent({ version: '1.0' }), null);
  const duplicated = fromHttpApiEvent({
    version: '2.0', rawPath: '/api/clinics/goodwell/bootstrap',
    headers: { Cookie: 'first=a', cookie: 'second=b' },
    requestContext: { http: { method: 'GET' } },
  });
  assert.equal(duplicated, null);
});

test('first sign-in: temporary password asks for a new one, then signs in once and the old one stops working', async () => {
  const h = harness();
  h.setPending(true);
  const csrf = await h.bootstrap('goodwell', 'a');
  const first = await h.login('goodwell', csrf, 'a');
  assert.equal(first.statusCode, 409);
  assert.equal(JSON.parse(first.body).code, 'new_password_required');
  assert.equal((first.cookies ?? []).some((cookie) => cookie.startsWith('__Host-cpz_session=') && !cookie.includes('Max-Age=0')), false);
  const temp = h.password;
  const set = (body) => h.request('goodwell', 'auth/set-password', { method: 'POST', cookieKey: 'a', headers: { 'x-csrf-token': csrf }, body });
  assert.equal((await set({ username: 'reception', password: 'wrong-temp', newPassword: 'Abcdefgh1234!' })).statusCode, 401);
  assert.equal((await set({ username: 'reception', password: temp, newPassword: 'short' })).statusCode, 400);
  assert.equal((await set({ username: 'reception', password: temp, newPassword: temp })).statusCode, 400);
  const weak = await set({ username: 'reception', password: temp, newPassword: 'alllowercase1234!' });
  assert.equal(weak.statusCode, 400); assert.equal(JSON.parse(weak.body).code, 'weak_password');
  const ok = await set({ username: 'reception', password: temp, newPassword: 'Abcdefgh1234!' });
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.cookies.some((cookie) => cookie.startsWith('__Host-cpz_session=')));
  assert.equal(JSON.parse(ok.body).user.role, 'receptionist');
  // The temporary password is dead; a second set-password cannot be used to take over.
  const again = await h.bootstrap('goodwell', 'b');
  const retry = await h.request('goodwell', 'auth/set-password', { method: 'POST', cookieKey: 'b', headers: { 'x-csrf-token': again }, body: { username: 'reception', password: temp, newPassword: 'Zyxwvuts9876!' } });
  assert.equal(retry.statusCode, 401);
  const signedIn = await h.login('goodwell', await h.bootstrap('goodwell', 'c'), 'c', 'Abcdefgh1234!');
  assert.equal(signedIn.statusCode, 200);
});

test('set-password needs the clinic CSRF pair and an active membership in that clinic only', async () => {
  const h = harness();
  h.setPending(true);
  const body = { username: 'reception', password: h.password, newPassword: 'Abcdefgh1234!' };
  const noCsrf = await h.request('goodwell', 'auth/set-password', { method: 'POST', cookieKey: 'x', body });
  assert.equal(noCsrf.statusCode, 403);
  const csrf = await h.bootstrap('goodwell', 'y');
  const wrongUser = await h.request('goodwell', 'auth/set-password', { method: 'POST', cookieKey: 'y', headers: { 'x-csrf-token': csrf }, body: { ...body, username: 'nobody' } });
  assert.equal(wrongUser.statusCode, 401);
  h.repo.members.get('goodwell:reception').active = false;
  const inactive = await h.request('goodwell', 'auth/set-password', { method: 'POST', cookieKey: 'y', headers: { 'x-csrf-token': csrf }, body });
  assert.equal(inactive.statusCode, 401);
});

test('forgot password answers identically for real and unknown users; reset needs the emailed code and is rate limited', async () => {
  const h = harness();
  const csrf = await h.bootstrap('goodwell', 'f');
  const post = (endpoint, body, key = 'f', token = csrf) => h.request('goodwell', endpoint, { method: 'POST', cookieKey: key, headers: { 'x-csrf-token': token }, body });
  assert.equal((await post('auth/forgot', { username: 'reception' })).statusCode, 204);
  assert.equal((await post('auth/forgot', { username: 'ghost-user' })).statusCode, 204);
  assert.deepEqual(h.resets, ['goodwell-staff']);
  assert.equal((await h.request('goodwell', 'auth/forgot', { method: 'POST', cookieKey: 'none', body: { username: 'reception' } })).statusCode, 403);
  const badCode = await post('auth/reset', { username: 'reception', code: '000000', newPassword: 'Abcdefgh1234!' });
  assert.equal(badCode.statusCode, 400); assert.equal(JSON.parse(badCode.body).code, 'invalid_code');
  assert.equal((await post('auth/reset', { username: 'reception', code: '12345', newPassword: 'Abcdefgh1234!' })).statusCode, 400);
  const weak = await post('auth/reset', { username: 'reception', code: '123456', newPassword: 'alllowercase1234!' });
  assert.equal(JSON.parse(weak.body).code, 'weak_password');
  const done = await post('auth/reset', { username: 'reception', code: '123456', newPassword: 'Newpassw0rd!!' });
  assert.equal(done.statusCode, 204);
  assert.equal((await h.login('goodwell', await h.bootstrap('goodwell', 'g'), 'g', 'Newpassw0rd!!')).statusCode, 200);
  const spam = await h.bootstrap('goodwell', 's');
  for (let i = 0; i < 6; i += 1) await post('auth/reset', { username: 'reception', code: '000000', newPassword: 'Abcdefgh1234!' }, 's', spam);
  assert.equal((await post('auth/reset', { username: 'reception', code: '123456', newPassword: 'Another0ne!!!!' }, 's', spam)).statusCode, 429);
});
