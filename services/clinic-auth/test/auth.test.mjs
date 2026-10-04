import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClinicAuthApp } from '../src/app.ts';
import { AuthStore } from '../src/store.ts';

function password() { return randomBytes(24).toString('base64url'); }

function setup(path = ':memory:') {
  const store = new AuthStore(path);
  const clinicA = store.createClinic('goodwell', 'Goodwell Clinic');
  const clinicB = store.createClinic('blesswell', 'Blesswell Clinic');
  const passwordA = password();
  const passwordB = password();
  store.createStaff(clinicA.id, 'reception.a', 'Reception A', 'receptionist', passwordA);
  store.createStaff(clinicB.id, 'reception.b', 'Reception B', 'receptionist', passwordB);
  return { store, app: createClinicAuthApp(store, { publicPort: 5174 }), passwordA, passwordB };
}

function makeClient(app, slug) {
  const host = `${slug}.localhost:5174`;
  const jar = new Map();
  async function call(path, { method = 'GET', json, csrf, origin = `http://${host}`, cookie } = {}) {
    const headers = new Headers({ Host: host });
    if (method !== 'GET') headers.set('Origin', origin);
    if (json) headers.set('Content-Type', 'application/json');
    if (csrf) headers.set('X-CSRF-Token', csrf);
    const saved = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookie ?? saved) headers.set('Cookie', cookie ?? saved);
    const request = new Request(`http://${host}${path}`, { method, headers, body: json ? JSON.stringify(json) : undefined });
    const response = await app.handle(request);
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(';');
      const [name, value] = pair.split('=');
      if (setCookie.includes('Max-Age=0')) jar.delete(name);
      else jar.set(name, value);
    }
    return { response, body: response.status === 204 ? null : await response.json(), cookies: new Map(jar) };
  }
  return { call, jar };
}

test('local login requires clinic bootstrap, valid credentials, and a scoped cookie session', async () => {
  const { store, app, passwordA } = setup();
  try {
    const client = makeClient(app, 'goodwell');
    const before = await client.call('/api/auth/session');
    assert.equal(before.response.status, 401);

    const bootstrap = await client.call('/api/clinic/bootstrap');
    assert.equal(bootstrap.response.status, 200);
    assert.equal(bootstrap.body.clinic.displayName, 'Goodwell Clinic');
    assert.equal(bootstrap.body.clinic.slug, 'goodwell');
    assert.ok(bootstrap.response.headers.getSetCookie()[0].includes('HttpOnly'));
    assert.ok(!bootstrap.response.headers.getSetCookie()[0].includes('Domain='));
    const loggedIn = await client.call('/api/auth/login', {
      method: 'POST', csrf: bootstrap.body.csrfToken,
      json: { username: 'reception.a', password: passwordA },
    });
    assert.equal(loggedIn.response.status, 200);
    assert.equal(loggedIn.body.clinicSlug, 'goodwell');
    assert.equal(loggedIn.body.user.role, 'receptionist');
    assert.notEqual(loggedIn.body.csrfToken, bootstrap.body.csrfToken);
    assert.equal(loggedIn.cookies.has('cpz_local_pre'), false);
    assert.equal(loggedIn.cookies.has('cpz_local_session'), true);

    const session = await client.call('/api/auth/session');
    assert.equal(session.response.status, 200);
    assert.equal(session.body.user.id, loggedIn.body.user.id);
    assert.equal(session.body.csrfToken, loggedIn.body.csrfToken);
  } finally { store.close(); }
});

test('cross-clinic login and replayed session cookies are denied', async () => {
  const { store, app, passwordA, passwordB } = setup();
  try {
    const a = makeClient(app, 'goodwell');
    const b = makeClient(app, 'blesswell');
    const aBootstrap = await a.call('/api/clinic/bootstrap');
    const aLogin = await a.call('/api/auth/login', {
      method: 'POST', csrf: aBootstrap.body.csrfToken,
      json: { username: 'reception.a', password: passwordA },
    });
    assert.equal(aLogin.response.status, 200);
    const stolenCookie = `cpz_local_session=${aLogin.cookies.get('cpz_local_session')}`;
    const replay = await b.call('/api/auth/session', { cookie: stolenCookie });
    assert.equal(replay.response.status, 401);

    const bBootstrap = await b.call('/api/clinic/bootstrap');
    const foreignLogin = await b.call('/api/auth/login', {
      method: 'POST', csrf: bBootstrap.body.csrfToken,
      json: { username: 'reception.a', password: passwordA },
    });
    assert.equal(foreignLogin.response.status, 401);
    const bLogin = await b.call('/api/auth/login', {
      method: 'POST', csrf: bBootstrap.body.csrfToken,
      json: { username: 'reception.b', password: passwordB },
    });
    assert.equal(bLogin.response.status, 200);
    assert.notEqual(bLogin.body.user.id, aLogin.body.user.id);
  } finally { store.close(); }
});

test('bad password, invalid CSRF, and wrong Origin cannot create a session', async () => {
  const { store, app, passwordA } = setup();
  try {
    const client = makeClient(app, 'goodwell');
    const bootstrap = await client.call('/api/clinic/bootstrap');
    const wrongCsrf = await client.call('/api/auth/login', {
      method: 'POST', csrf: randomBytes(20).toString('hex'),
      json: { username: 'reception.a', password: passwordA },
    });
    assert.equal(wrongCsrf.response.status, 403);
    const wrongOrigin = await client.call('/api/auth/login', {
      method: 'POST', csrf: bootstrap.body.csrfToken, origin: 'http://other.localhost:5174',
      json: { username: 'reception.a', password: passwordA },
    });
    assert.equal(wrongOrigin.response.status, 403);
    const wrongPassword = await client.call('/api/auth/login', {
      method: 'POST', csrf: bootstrap.body.csrfToken,
      json: { username: 'reception.a', password: password() },
    });
    assert.equal(wrongPassword.response.status, 401);
    assert.equal(client.jar.has('cpz_local_session'), false);
  } finally { store.close(); }
});

test('logout requires current authenticated CSRF and invalidates the server session', async () => {
  const { store, app, passwordA } = setup();
  try {
    const client = makeClient(app, 'goodwell');
    const bootstrap = await client.call('/api/clinic/bootstrap');
    const login = await client.call('/api/auth/login', {
      method: 'POST', csrf: bootstrap.body.csrfToken,
      json: { username: 'reception.a', password: passwordA },
    });
    assert.equal(login.response.status, 200);
    const wrong = await client.call('/api/auth/logout', { method: 'POST', csrf: bootstrap.body.csrfToken });
    assert.equal(wrong.response.status, 403);
    assert.equal((await client.call('/api/auth/session')).response.status, 200);
    const logout = await client.call('/api/auth/logout', { method: 'POST', csrf: login.body.csrfToken });
    assert.equal(logout.response.status, 204);
    assert.equal((await client.call('/api/auth/session')).response.status, 401);
  } finally { store.close(); }
});

test('reserved clinic slugs are rejected and local SQLite accounts survive reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clinicpluz-auth-test-'));
  const path = join(dir, 'auth.sqlite');
  try {
    let state = setup(path);
    assert.throws(() => state.store.createClinic('admin', 'Admin Clinic'));
    state.store.close();
    const reopened = new AuthStore(path);
    assert.equal(reopened.findClinic('goodwell')?.display_name, 'Goodwell Clinic');
    assert.equal(reopened.findStaff(reopened.findClinic('blesswell').id, 'reception.b')?.role, 'receptionist');
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('five failed passwords throttle that clinic username, then the lock expires', async () => {
  const state = setup();
  const clock = { now: Date.now() };
  const app = createClinicAuthApp(state.store, { publicPort: 5174, now: () => clock.now });
  try {
    const client = makeClient(app, 'goodwell');
    const bootstrap = await client.call('/api/clinic/bootstrap');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await client.call('/api/auth/login', {
        method: 'POST', csrf: bootstrap.body.csrfToken,
        json: { username: 'reception.a', password: password() },
      });
      assert.equal(wrong.response.status, 401);
    }
    const blocked = await client.call('/api/auth/login', {
      method: 'POST', csrf: bootstrap.body.csrfToken,
      json: { username: 'reception.a', password: state.passwordA },
    });
    assert.equal(blocked.response.status, 429);
    clock.now += 15 * 60_000 + 1;
    const fresh = await client.call('/api/clinic/bootstrap');
    const allowed = await client.call('/api/auth/login', {
      method: 'POST', csrf: fresh.body.csrfToken,
      json: { username: 'reception.a', password: state.passwordA },
    });
    assert.equal(allowed.response.status, 200);
  } finally { state.store.close(); }
});

test('deactivated staff and expired sessions lose access immediately', async () => {
  const state = setup();
  const clock = { now: Date.now() };
  const app = createClinicAuthApp(state.store, { publicPort: 5174, now: () => clock.now });
  try {
    const client = makeClient(app, 'goodwell');
    const bootstrap = await client.call('/api/clinic/bootstrap');
    const login = await client.call('/api/auth/login', {
      method: 'POST', csrf: bootstrap.body.csrfToken,
      json: { username: 'reception.a', password: state.passwordA },
    });
    assert.equal(login.response.status, 200);
    state.store.db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(login.body.user.id);
    assert.equal((await client.call('/api/auth/session')).response.status, 401);
    state.store.db.prepare('UPDATE staff SET active = 1 WHERE id = ?').run(login.body.user.id);
    clock.now += 8 * 60 * 60_000 + 1;
    assert.equal((await client.call('/api/auth/session')).response.status, 401);
  } finally { state.store.close(); }
});

test('unknown or disabled clinics and invalid hosts disclose no bootstrap', async () => {
  const { store, app } = setup();
  try {
    assert.equal((await makeClient(app, 'unknown').call('/api/clinic/bootstrap')).response.status, 404);
    store.db.prepare('UPDATE clinics SET active = 0 WHERE slug = ?').run('blesswell');
    assert.equal((await makeClient(app, 'blesswell').call('/api/clinic/bootstrap')).response.status, 404);
    for (const host of ['admin.localhost:5174', 'goodwell.localhost:5175', 'foo.goodwell.localhost:5174']) {
      const response = await app.handle(new Request('http://goodwell.localhost:5174/api/clinic/bootstrap', { headers: { Host: host } }));
      assert.equal(response.status, 421, host);
    }
  } finally { store.close(); }
});
