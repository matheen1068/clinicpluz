import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorkflowApp } from '../src/core.ts';
import { fromHttpApiEvent } from '../src/http-api.ts';

const ORIGIN = 'https://example123.cloudfront.net';
const EDGE_KEY = 'e'.repeat(48);
const COOKIE = 'c'.repeat(43);
const CSRF = 'csrf-token-for-synthetic-staging';
const NOW = new Date('2026-10-09T10:00:00Z');
const ROOT = '/api/workflow/clinics';

function setup() {
  const sessions = new Map([[createHash('sha256').update(COOKIE).digest('hex'), {
    clinicSlug: 'goodwell', username: 'reception', sub: 'staff-sub-1', csrfToken: CSRF,
    expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
  }]]);
  const clinics = new Map([
    ['goodwell', { slug: 'goodwell', active: true }],
    ['blesswell', { slug: 'blesswell', active: true }],
  ]);
  const members = new Map([
    ['goodwell/reception', { clinicSlug: 'goodwell', username: 'reception', cognitoUsername: 'internal-1',
      sub: 'staff-sub-1', role: 'receptionist', active: true }],
  ]);
  const modules = new Map([
    ['goodwell', { clinicSlug: 'goodwell', patient_intake: true, appointments: true }],
    ['blesswell', { clinicSlug: 'blesswell', patient_intake: true, appointments: true }],
  ]);
  const auth = {
    async getSession(hash) { return sessions.get(hash) ?? null; },
    async getClinic(slug) { return clinics.get(slug) ?? null; },
    async getMembership(slug, username) { return members.get(`${slug}/${username}`) ?? null; },
    async getEntitlements(slug) { return modules.get(slug) ?? null; },
  };
  let cognitoActive = true;
  const identity = { async isActive() { return cognitoActive; } };
  const doctors = new Map([
    ['goodwell', [{ id: 'd1', displayName: 'Dr One', active: true }, { id: 'd2', displayName: 'Dr Two', active: true }]],
    ['blesswell', [{ id: 'd1', displayName: 'Dr Other', active: true }]],
  ]);
  const schedules = new Map([
    ['goodwell', { timezone: 'Asia/Kolkata', openMinute: 570, closeMinute: 1110, slotMinutes: 30 }],
    ['blesswell', { timezone: 'Asia/Kolkata', openMinute: 570, closeMinute: 1110, slotMinutes: 30 }],
  ]);
  const patients = new Map();
  const appointments = new Map();
  const occupied = new Set();
  const audit = [];
  const store = {
    async getSchedule(slug) { return schedules.get(slug) ?? null; },
    async listDoctors(slug) { return doctors.get(slug) ?? []; },
    async getDoctor(slug, id) { return (doctors.get(slug) ?? []).find((doctor) => doctor.id === id) ?? null; },
    async searchPatients(slug, kind, prefix) {
      return [...(patients.get(slug)?.values() ?? [])].filter((patient) =>
        kind === 'name' ? patient.fullName.toLowerCase().startsWith(prefix)
          : patient.phone.replace(/\D/g, '').startsWith(prefix));
    },
    async getPatient(slug, id) { return patients.get(slug)?.get(id) ?? null; },
    async createPatient(slug, patient, _nameKey, _phoneKey, actorSub) {
      if (!patients.has(slug)) patients.set(slug, new Map());
      patients.get(slug).set(patient.id, patient);
      audit.push({ action: 'patient.registered', slug, actorSub });
    },
    async listAppointments(slug, date) { return (appointments.get(slug) ?? []).filter((appt) => appt.clinicDate === date); },
    async createAppointment(slug, appointment) {
      const key = `${slug}/${appointment.doctorId}/${appointment.startUtc}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
      appointments.set(slug, [...(appointments.get(slug) ?? []), appointment]);
      audit.push({ action: 'appointment.created', slug, actorSub: appointment.createdBySub });
      return true;
    },
  };
  const app = createWorkflowApp(auth, identity, store, { publicOrigin: ORIGIN, edgeKey: EDGE_KEY, now: () => NOW });
  async function call(method, path, payload, options = {}) {
    const response = await app.handle({
      method, path, queryString: options.queryString ?? '',
      headers: { 'x-clinicpluz-edge-key': EDGE_KEY,
        ...(method === 'POST' ? { origin: ORIGIN, 'x-csrf-token': CSRF, 'content-type': 'application/json' } : {}),
        ...options.headers },
      cookies: options.cookies ?? [`__Host-cpz_session=${COOKIE}`],
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: response.statusCode, body: JSON.parse(response.body), headers: response.headers };
  }
  return { call, auth, store, sessions, clinics, members, modules, schedules, doctors, patients, appointments,
    audit, setCognitoActive: (value) => { cognitoActive = value; } };
}
const patient = { fullName: 'Amina Khan', phone: '+91 98765 43210', ageYears: 38, sex: 'female', email: 'amina@example.test' };

test('session, clinic, role, Cognito state, and entitlements are checked on every request', async () => {
  const world = setup();
  const path = `${ROOT}/goodwell/doctors`;
  assert.equal((await world.call('GET', path, undefined, { cookies: [] })).status, 401);
  assert.equal((await world.call('GET', `${ROOT}/blesswell/doctors`)).status, 403);
  assert.equal((await world.call('GET', path, undefined, { headers: { 'x-clinicpluz-edge-key': 'bad' } })).status, 403);
  assert.equal((await world.call('GET', path)).status, 200);
  for (const role of ['doctor', 'lab_tech', 'billing']) {
    world.members.get('goodwell/reception').role = role;
    assert.equal((await world.call('GET', path)).status, 403);
    assert.equal((await world.call('POST', `${ROOT}/goodwell/patients/search`, { query: 'Demo' })).status, 403);
  }
  world.members.get('goodwell/reception').role = 'receptionist';
  world.modules.delete('goodwell');
  assert.equal((await world.call('GET', path)).status, 403);
  world.modules.set('goodwell', { clinicSlug: 'goodwell', patient_intake: true, appointments: false });
  assert.equal((await world.call('GET', path)).status, 403);
  world.modules.get('goodwell').appointments = true;
  world.modules.get('goodwell').patient_intake = false;
  assert.equal((await world.call('POST', `${ROOT}/goodwell/patients/search`, { query: 'Demo' })).status, 403);
  world.modules.get('goodwell').patient_intake = true;
  world.setCognitoActive(false);
  assert.equal((await world.call('GET', path)).status, 403);
  world.setCognitoActive(true);
  world.members.get('goodwell/reception').active = false;
  assert.equal((await world.call('GET', path)).status, 403);
  world.members.get('goodwell/reception').active = true;
  world.sessions.values().next().value.expiresAt = Math.floor(NOW.getTime() / 1000);
  assert.equal((await world.call('GET', path)).status, 401);
});

test('patient search stays in a CSRF-protected POST body and registration validates required fields', async () => {
  const world = setup();
  const path = `${ROOT}/goodwell/patients`;
  assert.equal((await world.call('POST', path, { ...patient, ageYears: '38' })).status, 400);
  assert.equal((await world.call('POST', path, { ...patient, sex: 'unspecified' })).status, 400);
  assert.equal((await world.call('POST', path, { ...patient, email: undefined })).status, 201);
  const registered = await world.call('POST', path, patient);
  assert.equal(registered.status, 201);
  assert.equal(registered.body.patient.ageYears, 38);
  assert.equal(registered.body.patient.email, patient.email);
  assert.equal(registered.headers['cache-control'], 'no-store');
  assert.equal((await world.call('GET', `${path}?q=Amina`)).status, 404);
  assert.equal((await world.call('POST', `${path}/search`, { query: 'Am' })).body.items.length, 2);
  assert.equal((await world.call('POST', `${path}/search`, { query: '+91 98765' })).body.items.length, 2);
  assert.equal((await world.call('POST', `${path}/search`, { query: 'A' })).status, 400);
  assert.equal((await world.call('POST', `${path}/search`, { query: 'Am' },
    { headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  assert.equal((await world.call('POST', path, patient, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal(world.audit.length, 2);
});

test('30-minute pilot schedule is validated from clinic settings, including timezone and closing boundary', async () => {
  const world = setup();
  const registered = await world.call('POST', `${ROOT}/goodwell/patients`, patient);
  const patientId = registered.body.patient.id;
  const book = (startAt) => world.call('POST', `${ROOT}/goodwell/appointments`,
    { patientId, doctorId: 'd1', startAt, source: 'phone' });
  assert.equal((await book('2026-10-10T09:00:00+05:30')).status, 400);
  assert.equal((await book('2026-10-10T18:30:00+05:30')).status, 400);
  assert.equal((await book('2026-10-10T09:15:00+05:30')).status, 400);
  assert.equal((await book('2026-10-10T02:00:00Z')).status, 400);
  assert.equal((await book('2026-10-10T04:00:00.000Z')).status, 201);
  assert.equal((await book('2026-02-31T09:30:00+05:30')).status, 400);
  assert.equal((await book('2026-10-09T15:00:00+05:30')).status, 400);
  assert.equal((await book('2026-10-09T15:30:00+05:30')).status, 201);
  assert.equal((await book('2026-10-10T18:00:00+05:30')).status, 201);
  world.schedules.delete('goodwell');
  assert.equal((await book('2026-10-10T10:00:00+05:30')).status, 503);
});

test('doctor-slot lock prevents concurrent double booking; phone and walk-in statuses feed one clinic date list', async () => {
  const world = setup();
  const registered = await world.call('POST', `${ROOT}/goodwell/patients`, patient);
  const patientId = registered.body.patient.id;
  const path = `${ROOT}/goodwell/appointments`;
  const payload = { patientId, doctorId: 'd1', startAt: '2026-10-10T10:00:00+05:30', source: 'phone' };
  const results = await Promise.all([world.call('POST', path, payload), world.call('POST', path, payload)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const otherDoctor = await world.call('POST', path, { ...payload, doctorId: 'd2', source: 'walk_in' });
  assert.equal(otherDoctor.status, 201);
  assert.equal(otherDoctor.body.appointment.status, 'checked_in');
  const listing = await world.call('GET', path, undefined, { queryString: 'date=2026-10-10' });
  assert.equal(listing.status, 200);
  assert.equal(listing.body.items.length, 2);
  assert.deepEqual(new Set(listing.body.items.map((item) => item.status)), new Set(['booked', 'checked_in']));
  assert.equal((await world.call('GET', path, undefined, { queryString: 'date=2026-02-31' })).status, 400);
  assert.equal(world.audit.filter((event) => event.action === 'appointment.created').length, 2);
});

test('patient and appointment data cannot be read through a different clinic path', async () => {
  const world = setup();
  await world.call('POST', `${ROOT}/goodwell/patients`, patient);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/patients/search`, { query: 'Amina' })).status, 403);
  assert.equal(world.patients.get('blesswell'), undefined);
  const mapped = fromHttpApiEvent({ version: '2.0', rawPath: `${ROOT}/goodwell/patients/search`,
    rawQueryString: '', headers: { Origin: ORIGIN }, cookies: [`__Host-cpz_session=${COOKIE}`],
    requestContext: { http: { method: 'POST' } } });
  assert.equal(mapped.path, `${ROOT}/goodwell/patients/search`);
  assert.equal(fromHttpApiEvent({ version: '2.0', rawPath: '/', headers: { Origin: 'a', origin: 'b' },
    requestContext: { http: { method: 'GET' } } }), null);
});
