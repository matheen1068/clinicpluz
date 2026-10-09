import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorkflowApp } from '../src/core.ts';
import { fromHttpApiEvent } from '../src/http-api.ts';

const ORIGIN = 'https://example123.cloudfront.net';
const EDGE_KEY = 'e'.repeat(48);
const COOKIE = 'c'.repeat(43);
const DOCTOR_COOKIE = 'd'.repeat(43);
const OTHER_DOCTOR_COOKIE = 'o'.repeat(43);
const NURSE_COOKIE = 'n'.repeat(43);
const CSRF = 'csrf-token-for-synthetic-staging';
const NOW = new Date('2026-10-09T10:00:00Z');
const ROOT = '/api/workflow/clinics';

test('clinic medicine search is doctor-only, tenant-scoped, and never returns inactive items', async () => {
  const world = setup();
  const route = `${ROOT}/goodwell/consultations/medicines/search`;
  const doctor = { cookies: [`__Host-cpz_session=${DOCTOR_COOKIE}`] };
  const found = await world.call('POST', route, { query: 'Synthetic tablet' }, doctor);
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.items.map((item) => item.id), ['med-2', 'med-1']);
  assert.equal(found.body.items.some((item) => item.id === 'med-3' || item.id === 'med-4'), false);
  assert.equal((await world.call('POST', route, { query: 'tablet' })).status, 403);
  assert.equal((await world.call('POST', route, { query: 'tablet' }, { cookies: [`__Host-cpz_session=${NURSE_COOKIE}`] })).status, 403);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/consultations/medicines/search`, { query: 'tablet' }, doctor)).status, 403);
  assert.equal((await world.call('POST', route, { query: 'tablet' }, { ...doctor, headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  assert.equal((await world.call('POST', route, { query: 'x' }, doctor)).status, 400);
  world.modules.get('goodwell').consultations = false;
  assert.equal((await world.call('POST', route, { query: 'tablet' }, doctor)).status, 403);
});

function setup() {
  const sessions = new Map([[createHash('sha256').update(COOKIE).digest('hex'), {
    clinicSlug: 'goodwell', username: 'reception', sub: 'staff-sub-1', csrfToken: CSRF,
    expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
  }], [createHash('sha256').update(DOCTOR_COOKIE).digest('hex'), {
    clinicSlug: 'goodwell', username: 'doctor1', sub: 'doctor-sub-1', csrfToken: CSRF,
    expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
  }], [createHash('sha256').update(OTHER_DOCTOR_COOKIE).digest('hex'), {
    clinicSlug: 'goodwell', username: 'doctor2', sub: 'doctor-sub-2', csrfToken: CSRF,
    expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
  }], [createHash('sha256').update(NURSE_COOKIE).digest('hex'), {
    clinicSlug: 'goodwell', username: 'nurse', sub: 'nurse-sub-1', csrfToken: CSRF,
    expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
  }]]);
  const clinics = new Map([
    ['goodwell', { slug: 'goodwell', displayName: 'Goodwell Demo Clinic', active: true }],
    ['blesswell', { slug: 'blesswell', displayName: 'Blesswell Demo Clinic', active: true }],
  ]);
  const members = new Map([
    ['goodwell/reception', { clinicSlug: 'goodwell', username: 'reception', cognitoUsername: 'internal-1',
      sub: 'staff-sub-1', displayName: 'Demo Receptionist', role: 'receptionist', active: true }],
    ['goodwell/doctor1', { clinicSlug: 'goodwell', username: 'doctor1', cognitoUsername: 'internal-doctor-1',
      sub: 'doctor-sub-1', displayName: 'Dr One', role: 'doctor', active: true }],
    ['goodwell/doctor2', { clinicSlug: 'goodwell', username: 'doctor2', cognitoUsername: 'internal-doctor-2',
      sub: 'doctor-sub-2', displayName: 'Dr Two', role: 'doctor', active: true }],
    ['goodwell/nurse', { clinicSlug: 'goodwell', username: 'nurse', cognitoUsername: 'internal-nurse',
      sub: 'nurse-sub-1', displayName: 'Demo Nurse', role: 'nurse', active: true }],
  ]);
  const modules = new Map([
    ['goodwell', { clinicSlug: 'goodwell', patient_intake: true, appointments: true, consultations: true }],
    ['blesswell', { clinicSlug: 'blesswell', patient_intake: true, appointments: true, consultations: true }],
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
    ['goodwell', [{ id: 'd1', displayName: 'Dr One', active: true, staffSub: 'doctor-sub-1' },
      { id: 'd2', displayName: 'Dr Two', active: true, staffSub: 'doctor-sub-2' }]],
    ['blesswell', [{ id: 'd1', displayName: 'Dr Other', active: true }]],
  ]);
  const medicines = new Map([
    ['goodwell', [
      { id: 'med-1', name: 'Synthetic tablet A', strength: '5 mg', active: true, favorite: false },
      { id: 'med-2', name: 'Synthetic tablet B', strength: '5 mg', active: true, favorite: true },
      { id: 'med-3', name: 'Synthetic tablet hidden', strength: '5 mg', active: false, favorite: true },
    ]],
    ['blesswell', [{ id: 'med-4', name: 'Synthetic tablet Other', strength: '5 mg', active: true, favorite: true }]],
  ]);
  const schedules = new Map([
    ['goodwell', { timezone: 'Asia/Kolkata', openMinute: 570, closeMinute: 1110, slotMinutes: 30 }],
    ['blesswell', { timezone: 'Asia/Kolkata', openMinute: 570, closeMinute: 1110, slotMinutes: 30 }],
  ]);
  const patients = new Map();
  const appointments = new Map();
  const encounters = new Map();
  const occupied = new Set();
  const audit = [];
  const store = {
    async getSchedule(slug) { return schedules.get(slug) ?? null; },
    async listDoctors(slug) { return doctors.get(slug) ?? []; },
    async listMedicines(slug) { return medicines.get(slug) ?? []; },
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
    async getEncounter(slug, date, appointmentId) {
      return encounters.get(`${slug}/${date}/${appointmentId}`) ?? null;
    },
    async listEncounterStatuses(slug, date) {
      return new Map([...(encounters.entries())]
        .filter(([key]) => key.startsWith(`${slug}/${date}/`))
        .map(([, encounter]) => [encounter.appointmentId, encounter.status]));
    },
    async saveEncounter(slug, appointment, encounter, expectedRevision, actorSub, action, assignedDoctorSub) {
      const key = `${slug}/${encounter.clinicDate}/${encounter.appointmentId}`;
      const current = encounters.get(key);
      if ((current?.revision ?? 0) !== expectedRevision || current?.status === 'finalized') return false;
      if (!(appointments.get(slug) ?? []).some((row) => row.id === appointment.id &&
          row.patientId === encounter.patientId && row.doctorId === encounter.doctorId) ||
          !patients.get(slug)?.has(encounter.patientId)) throw new Error('Broken appointment link');
      if (assignedDoctorSub && !(doctors.get(slug) ?? []).some((doctor) => doctor.id === appointment.doctorId &&
          doctor.active && doctor.staffSub === assignedDoctorSub)) throw new Error('Doctor mapping changed');
      encounters.set(key, encounter);
      audit.push({ action, slug, actorSub, revision: encounter.revision });
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
  return { call, auth, store, sessions, clinics, members, modules, schedules, doctors, medicines, patients, appointments, encounters,
    audit, setCognitoActive: (value) => { cognitoActive = value; } };
}
const patient = { fullName: 'Amina Khan', phone: '+91 98765 43210', ageYears: 38, sex: 'female', email: 'amina@example.test' };
const consultationBase = `${ROOT}/goodwell/consultations`;
const doctorSession = { cookies: [`__Host-cpz_session=${DOCTOR_COOKIE}`] };
const otherDoctorSession = { cookies: [`__Host-cpz_session=${OTHER_DOCTOR_COOKIE}`] };
const nurseSession = { cookies: [`__Host-cpz_session=${NURSE_COOKIE}`] };
const note = { chiefComplaint: 'Synthetic complaint', history: '', exam: 'Synthetic exam',
  assessment: 'Clinician-entered assessment', plan: 'Clinician-entered plan' };
const medications = [{ name: 'Demo Medicine', strength: '10 mg', dose: '1 tablet', route: 'oral',
  frequency: 'once daily', duration: '3 days', instructions: 'After food' }];

async function seedAppointment(world, doctorId = 'd1') {
  const registered = await world.call('POST', `${ROOT}/goodwell/patients`, patient);
  assert.equal(registered.status, 201);
  const booked = await world.call('POST', `${ROOT}/goodwell/appointments`, {
    patientId: registered.body.patient.id, doctorId, startAt: '2026-10-10T10:00:00+05:30', source: 'walk_in',
  });
  assert.equal(booked.status, 201);
  return { appointmentId: booked.body.appointment.id, clinicDate: '2026-10-10' };
}

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

test('consultation queue and read enforce clinician role, entitlement, and assigned doctor mapping', async () => {
  const world = setup();
  const own = await seedAppointment(world, 'd1');
  await seedAppointment(world, 'd2');
  const query = { queryString: 'date=2026-10-10' };
  assert.equal((await world.call('GET', consultationBase, undefined, query)).status, 403);
  const nurseQueue = await world.call('GET', consultationBase, undefined, { ...query, ...nurseSession });
  assert.equal(nurseQueue.status, 200);
  assert.equal(nurseQueue.body.items.length, 2);
  const doctorQueue = await world.call('GET', consultationBase, undefined, { ...query, ...doctorSession });
  assert.equal(doctorQueue.body.items.length, 1);
  assert.equal(doctorQueue.body.items[0].appointmentId, own.appointmentId);
  const read = await world.call('POST', `${consultationBase}/read`, own, doctorSession);
  assert.equal(read.status, 200);
  assert.equal(read.body.encounter.revision, 0);
  assert.equal(read.body.encounter.status, 'draft');
  assert.equal(read.body.encounter.vitals, null);
  assert.deepEqual(read.body.encounter.medications, []);
  assert.equal(read.body.printablePrescription, undefined);
  assert.equal((await world.call('POST', `${consultationBase}/read`, own, otherDoctorSession)).status, 403);
  assert.equal((await world.call('POST', `${consultationBase}/read`, own, nurseSession)).body.encounter.note, undefined);
  world.doctors.get('goodwell')[0].staffSub = undefined;
  assert.equal((await world.call('GET', consultationBase, undefined, { ...query, ...doctorSession })).body.items.length, 0);
  assert.equal((await world.call('POST', `${consultationBase}/read`, own, doctorSession)).status, 403);
  world.modules.get('goodwell').consultations = false;
  assert.equal((await world.call('POST', `${consultationBase}/read`, own, nurseSession)).status, 403);
  assert.equal((await world.call('GET', `${ROOT}/goodwell/doctors`)).status, 200);
  delete world.modules.get('goodwell').consultations;
  assert.equal((await world.call('POST', `${consultationBase}/read`, own, nurseSession)).status, 403);
  assert.equal((await world.call('GET', `${ROOT}/goodwell/doctors`)).status, 200);
  world.modules.get('goodwell').consultations = true;
  world.members.get('goodwell/reception').role = 'clinic_admin';
  assert.equal((await world.call('POST', `${consultationBase}/read`, own)).status, 403);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...own, expectedRevision: 0, note, medications })).status, 403);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/consultations/read`, own, nurseSession)).status, 403);
});

test('nurse vitals, doctor draft, and doctor finalization preserve attribution and print only finalized medicines', async () => {
  const world = setup();
  const selected = await seedAppointment(world);
  const vitals = { observedAt: NOW.toISOString(), systolicBpMmHg: 120, diastolicBpMmHg: 80,
    pulseBpm: 72, spo2Percent: 99, temperatureC: 37, weightKg: 65, heightCm: 168 };
  const savedVitals = await world.call('POST', `${consultationBase}/vitals`,
    { ...selected, expectedRevision: 0, vitals }, nurseSession);
  assert.equal(savedVitals.status, 200);
  assert.equal(savedVitals.body.encounter.revision, 1);
  assert.equal(savedVitals.body.encounter.vitals.recordedByDisplayName, 'Demo Nurse');
  assert.equal(savedVitals.body.encounter.note, undefined);
  const draft = await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 1, note, medications }, doctorSession);
  assert.equal(draft.status, 200);
  assert.equal(draft.body.encounter.vitals.pulseBpm, 72);
  assert.equal(draft.body.printablePrescription, undefined);
  assert.equal(world.encounters.get(`goodwell/${selected.clinicDate}/${selected.appointmentId}`).medications[0].prescriberSub,
    'doctor-sub-1');
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 2 }, nurseSession)).status, 403);
  const finalized = await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 2 }, doctorSession);
  assert.equal(finalized.status, 200);
  assert.equal(finalized.body.encounter.status, 'finalized');
  assert.equal(finalized.body.encounter.revision, 3);
  assert.equal(finalized.body.printablePrescription.clinic.displayName, 'Goodwell Demo Clinic');
  assert.equal(finalized.body.printablePrescription.patient.fullName, patient.fullName);
  assert.equal(finalized.body.printablePrescription.medications[0].dose, '1 tablet');
  assert.equal((await world.call('POST', `${consultationBase}/read`, selected, doctorSession)).body.printablePrescription.finalizedAt,
    finalized.body.encounter.finalizedAt);
  const nurseRead = await world.call('POST', `${consultationBase}/read`, selected, nurseSession);
  assert.equal(nurseRead.body.encounter.medications, undefined);
  assert.equal(nurseRead.body.printablePrescription, undefined);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 3, note, medications }, doctorSession)).status, 409);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 3 }, doctorSession)).status, 409);
  assert.deepEqual(world.audit.filter((entry) => entry.action.includes('saved') || entry.action === 'encounter.finalized')
    .map((entry) => entry.action), ['vitals.saved', 'draft.saved', 'encounter.finalized']);
});

test('consultation input, CSRF, stale revision, and incomplete finalization fail closed', async () => {
  const world = setup();
  const selected = await seedAppointment(world);
  const path = `${consultationBase}/vitals`;
  assert.equal((await world.call('POST', path,
    { ...selected, expectedRevision: 0, vitals: { observedAt: NOW.toISOString() } }, nurseSession)).status, 400);
  assert.equal((await world.call('POST', path,
    { ...selected, expectedRevision: 0, vitals: { observedAt: NOW.toISOString(), systolicBpMmHg: 120 } }, nurseSession)).status, 400);
  assert.equal((await world.call('POST', path,
    { ...selected, expectedRevision: 0, vitals: { observedAt: NOW.toISOString(), pulseBpm: 1000 } }, nurseSession)).status, 400);
  assert.equal((await world.call('POST', path,
    { ...selected, expectedRevision: 0, vitals: { observedAt: '2026-02-31T10:00:00Z', pulseBpm: 72 } }, nurseSession)).status, 400);
  assert.equal((await world.call('POST', path,
    { ...selected, expectedRevision: 0, vitals: { observedAt: '2026-10-09T10:00:00+14:30', pulseBpm: 72 } }, nurseSession)).status, 400);
  assert.equal((await world.call('POST', path,
    { ...selected, expectedRevision: 0, vitals: { observedAt: NOW.toISOString(), pulseBpm: 72 } },
    { ...nurseSession, headers: { 'x-csrf-token': 'bad' } })).status, 403);
  assert.equal((await world.call('POST', path,
    { ...selected, expectedRevision: 0, vitals: { observedAt: NOW.toISOString(), pulseBpm: 72 } },
    { ...nurseSession, headers: { origin: 'https://bad.example' } })).status, 403);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 0, note, medications }, nurseSession)).status, 403);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 0, note: { ...note, plan: 'a'.repeat(3001) }, medications }, doctorSession)).status, 400);
  const first = await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 0, note: { ...note, assessment: '' }, medications }, doctorSession);
  assert.equal(first.status, 200);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 1 }, doctorSession)).status, 400);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 0, note, medications }, doctorSession)).status, 409);
  const expired = world.sessions.get(createHash('sha256').update(DOCTOR_COOKIE).digest('hex'));
  expired.expiresAt = Math.floor(NOW.getTime() / 1000);
  assert.equal((await world.call('POST', `${consultationBase}/read`, selected, doctorSession)).status, 401);
  assert.equal(world.audit.filter((entry) => entry.action === 'draft.saved').length, 1);
});

test('concurrent encounter edits accept one revision and audit only the winning save', async () => {
  const world = setup();
  const selected = await seedAppointment(world);
  const firstVitals = { ...selected, expectedRevision: 0,
    vitals: { observedAt: NOW.toISOString(), pulseBpm: 70 } };
  const secondVitals = { ...selected, expectedRevision: 0,
    vitals: { observedAt: NOW.toISOString(), pulseBpm: 75 } };
  const raced = await Promise.all([
    world.call('POST', `${consultationBase}/vitals`, firstVitals, nurseSession),
    world.call('POST', `${consultationBase}/vitals`, secondVitals, nurseSession),
  ]);
  assert.deepEqual(raced.map((reply) => reply.status).sort(), [200, 409]);
  assert.equal(world.audit.filter((entry) => entry.action === 'vitals.saved').length, 1);
  assert.equal(world.encounters.get(`goodwell/${selected.clinicDate}/${selected.appointmentId}`).revision, 1);
});

test('later nurse vitals preserve doctor draft and require a fresh revision to finalize', async () => {
  const world = setup();
  const selected = await seedAppointment(world);
  const draft = await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 0, note, medications }, doctorSession);
  assert.equal(draft.status, 200);
  const vitals = await world.call('POST', `${consultationBase}/vitals`,
    { ...selected, expectedRevision: 1,
      vitals: { observedAt: NOW.toISOString(), pulseBpm: 74 } }, nurseSession);
  assert.equal(vitals.status, 200);
  const doctorRead = await world.call('POST', `${consultationBase}/read`, selected, doctorSession);
  assert.deepEqual(doctorRead.body.encounter.note, note);
  assert.equal(doctorRead.body.encounter.medications[0].name, medications[0].name);
  assert.equal(doctorRead.body.encounter.vitals.pulseBpm, 74);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 1 }, doctorSession)).status, 409);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 2 }, doctorSession)).status, 200);
});

test('finalized prescription retains the finalizing clinician when roster or membership changes', async () => {
  const world = setup();
  const selected = await seedAppointment(world);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 0, note, medications }, doctorSession)).status, 200);
  const finalized = await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 1 }, doctorSession);
  assert.equal(finalized.status, 200);
  assert.deepEqual(finalized.body.printablePrescription.doctor, { id: 'd1', displayName: 'Dr One' });
  const stored = world.encounters.get(`goodwell/${selected.clinicDate}/${selected.appointmentId}`);
  assert.equal(stored.finalizedBySub, 'doctor-sub-1');
  assert.equal(stored.finalizedByDisplayName, 'Dr One');
  assert.equal(stored.finalizedDoctorId, 'd1');

  world.doctors.get('goodwell')[0].displayName = 'Renamed Roster Doctor';
  world.members.get('goodwell/doctor1').displayName = 'Renamed Staff Account';
  const reprint = await world.call('POST', `${consultationBase}/read`, selected, doctorSession);
  assert.equal(reprint.status, 200);
  assert.deepEqual(reprint.body.printablePrescription.doctor, { id: 'd1', displayName: 'Dr One' });
  assert.deepEqual(reprint.body.encounter.doctor, { id: 'd1', displayName: 'Dr One' });

  world.doctors.get('goodwell')[0].staffSub = 'doctor-sub-2';
  assert.equal((await world.call('POST', `${consultationBase}/read`, selected, doctorSession)).status, 403);
  assert.equal((await world.call('POST', `${consultationBase}/read`, selected, otherDoctorSession)).status, 403);
  world.doctors.get('goodwell')[0].staffSub = 'doctor-sub-1';
  assert.deepEqual((await world.call('POST', `${consultationBase}/read`, selected, doctorSession))
    .body.printablePrescription.doctor, { id: 'd1', displayName: 'Dr One' });
});
