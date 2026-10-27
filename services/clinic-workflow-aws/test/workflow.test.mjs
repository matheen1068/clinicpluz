import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorkflowApp } from '../src/core.ts';
import { fromHttpApiEvent } from '../src/http-api.ts';
import { historyIdFor } from '../src/history.ts';
import { PDFDocument, decodePDFRawStream } from 'pdf-lib';

const ORIGIN = 'https://example123.cloudfront.net';
const EDGE_KEY = 'e'.repeat(48);
const COOKIE = 'c'.repeat(43);
const DOCTOR_COOKIE = 'd'.repeat(43);
const OTHER_DOCTOR_COOKIE = 'o'.repeat(43);
const NURSE_COOKIE = 'n'.repeat(43);
const PHARMACIST_COOKIE = 'p'.repeat(43);
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

function setup(options = {}) {
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
  }], [createHash('sha256').update(PHARMACIST_COOKIE).digest('hex'), {
    clinicSlug: 'goodwell', username: 'pharmacist', sub: 'pharmacist-sub-1', csrfToken: CSRF,
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
    ['goodwell/pharmacist', { clinicSlug: 'goodwell', username: 'pharmacist', cognitoUsername: 'internal-pharmacist',
      sub: 'pharmacist-sub-1', displayName: 'Demo Pharmacist', role: 'pharmacist', active: true }],
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
  const history = new Map();
  const deliveries = new Map();
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
    async createPatient(slug, patient, _nameKey, _phoneKey, actorSub, contact) {
      if (!patients.has(slug)) patients.set(slug, new Map());
      if (patients.get(slug).has(patient.id)) throw new Error('Patient ID collision');
      if (contact && (patient.contactPatientId !== contact.id ||
          patients.get(slug).get(contact.id)?.phone !== contact.phone)) throw new Error('Contact changed');
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
    async listPatientHistory(slug, patientId, before, limit) {
      return [...history.values()].filter((row) => row.clinicSlug === slug &&
        row.patientId === patientId && row.historyId < before)
        .sort((a, b) => b.historyId.localeCompare(a.historyId)).slice(0, limit);
    },
    async getHistoryEntry(slug, patientId, historyId) {
      return history.get(`${slug}/${patientId}/${historyId}`) ?? null;
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
      if (action === 'encounter.finalized') {
        const historyId = historyIdFor(appointment.startUtc, appointment.id);
        const indexKey = `${slug}/${appointment.patientId}/${historyId}`;
        if (history.has(indexKey)) throw new Error('History pointer already exists');
        history.set(indexKey, { historyId, clinicSlug: slug, patientId: appointment.patientId,
          appointmentId: appointment.id, clinicDate: appointment.clinicDate,
          visitAt: appointment.startAt, visitUtc: appointment.startUtc,
          status: 'finalized', finalizedAt: encounter.finalizedAt,
          doctor: { id: encounter.finalizedDoctorId, displayName: encounter.finalizedByDisplayName } });
      }
      audit.push({ action, slug, actorSub, revision: encounter.revision });
      return true;
    },
    async claimPrescriptionEmail(slug, appointmentId, revision, recipientHash, actorSub, at, context) {
      options.beforeEmailClaim?.();
      if (patients.get(slug)?.get(context.patientId)?.email !== context.storedEmail) return 'stored_email_changed';
      const current = encounters.get(`${slug}/${context.clinicDate}/${appointmentId}`);
      if (current?.status !== 'finalized' || current.revision !== revision ||
          current.patientId !== context.patientId || current.doctorId !== context.doctorId) {
        throw new Error('Finalized prescription changed before claim');
      }
      const key = `${slug}/${appointmentId}/${revision}`;
      const existing = deliveries.get(key);
      if (existing) return existing.recipientHash === recipientHash ? existing.status : 'recipient_changed';
      deliveries.set(key, { recipientHash, status: 'pending' });
      audit.push({ action: 'prescription.email.requested', slug, appointmentId, actorSub, at, revision });
      return 'claimed';
    },
    async markPrescriptionEmail(slug, appointmentId, revision, status, at, messageId) {
      const key = `${slug}/${appointmentId}/${revision}`;
      const delivery = deliveries.get(key);
      if (delivery?.status !== 'pending') throw new Error('Delivery claim changed');
      delivery.status = status;
      delivery.messageId = messageId;
      audit.push({ action: `prescription.email.${status}`, slug, appointmentId, at, revision });
    },
  };
  const app = createWorkflowApp(auth, identity, store, { publicOrigin: ORIGIN, edgeKey: EDGE_KEY,
    now: () => NOW, ...(options.prescriptionEmail ? { prescriptionEmail: options.prescriptionEmail } : {}) });
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
  return { call, auth, store, sessions, clinics, members, modules, schedules, doctors, medicines, patients, appointments, encounters, history, deliveries,
    audit, setCognitoActive: (value) => { cognitoActive = value; } };
}
const patient = { fullName: 'Amina Khan', phone: '+91 98765 43210', ageYears: 38, sex: 'female', email: 'amina@example.test' };
const consultationBase = `${ROOT}/goodwell/consultations`;
const doctorSession = { cookies: [`__Host-cpz_session=${DOCTOR_COOKIE}`] };
const otherDoctorSession = { cookies: [`__Host-cpz_session=${OTHER_DOCTOR_COOKIE}`] };
const nurseSession = { cookies: [`__Host-cpz_session=${NURSE_COOKIE}`] };
const pharmacistSession = { cookies: [`__Host-cpz_session=${PHARMACIST_COOKIE}`] };
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

async function bookFor(world, patientId, doctorId, startAt) {
  const booked = await world.call('POST', `${ROOT}/goodwell/appointments`,
    { patientId, doctorId, startAt, source: 'walk_in' });
  assert.equal(booked.status, 201);
  return { appointmentId: booked.body.appointment.id, clinicDate: startAt.slice(0, 10) };
}

async function finalizeFor(world, selected, clinician = doctorSession) {
  const draft = await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 0, note, medications }, clinician);
  assert.equal(draft.status, 200);
  const finalized = await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 1 }, clinician);
  assert.equal(finalized.status, 200);
  return finalized;
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

test('same-phone patients get distinct persisted IDs and an optional same-clinic contact link without email inheritance', async () => {
  const world = setup();
  const path = `${ROOT}/goodwell/patients`;
  const parent = await world.call('POST', path, patient);
  assert.equal(parent.status, 201);
  assert.match(parent.body.patient.id, /^[a-f0-9-]{36}$/);
  assert.equal(parent.body.patient.contactPatientId, null);
  const child = await world.call('POST', path, {
    fullName: 'Demo Child', phone: '+91 (98765) 43210', ageYears: 8, sex: 'male',
    contactPatientId: parent.body.patient.id,
  });
  assert.equal(child.status, 201);
  assert.notEqual(child.body.patient.id, parent.body.patient.id);
  assert.equal(child.body.patient.contactPatientId, parent.body.patient.id);
  assert.equal(child.body.patient.email, null);
  const unrelated = await world.call('POST', path, { ...patient, fullName: 'Demo Other', email: null });
  assert.equal(unrelated.status, 201);
  assert.notEqual(unrelated.body.patient.id, child.body.patient.id);
  assert.equal(unrelated.body.patient.contactPatientId, null);
  const rows = (await world.call('POST', `${path}/search`, { query: '+91 98765' })).body.items;
  assert.deepEqual(new Set(rows.map((row) => row.id)), new Set([
    parent.body.patient.id, child.body.patient.id, unrelated.body.patient.id,
  ]));
  assert.equal(rows.find((row) => row.id === child.body.patient.id).contactPatientId, parent.body.patient.id);
  assert.equal(world.patients.get('goodwell').size, 3);
  assert.equal(world.audit.filter((entry) => entry.action === 'patient.registered').length, 3);
});

test('contact link rejects unknown, wrong-clinic, malformed, or different-phone patients without registering', async () => {
  const world = setup();
  const path = `${ROOT}/goodwell/patients`;
  const parent = (await world.call('POST', path, patient)).body.patient;
  const before = world.audit.length;
  world.patients.set('blesswell', new Map([['other-clinic-id', { ...parent, id: 'other-clinic-id' }]]));
  for (const input of [
    { contactPatientId: 'missing-id' },
    { contactPatientId: 'other-clinic-id' },
    { contactPatientId: '../bad' },
    { contactPatientId: parent.id, phone: '+91 98765 43211' },
  ]) {
    assert.equal((await world.call('POST', path, { ...patient, fullName: 'Demo Child', ...input })).status, 400);
  }
  assert.equal(world.patients.get('goodwell').size, 1);
  assert.equal(world.audit.length, before);
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

test('consultation queue and read enforce vitals staff scope, entitlement, and assigned doctor mapping', async () => {
  const world = setup();
  const own = await seedAppointment(world, 'd1');
  await seedAppointment(world, 'd2');
  const query = { queryString: 'date=2026-10-10' };
  assert.equal((await world.call('GET', consultationBase, undefined, query)).status, 200);
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
  assert.equal((await world.call('POST', `${consultationBase}/read`, own)).status, 200);
  assert.equal((await world.call('POST', `${consultationBase}/read`, own)).body.encounter.note, undefined);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...own, expectedRevision: 0, note, medications })).status, 403);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/consultations/read`, own, nurseSession)).status, 403);
});

test('reception and clinic admin save shared vitals without access to doctor notes or prescriptions', async () => {
  const world = setup();
  const selected = await seedAppointment(world);
  const first = await world.call('POST', `${consultationBase}/vitals`, {
    ...selected, expectedRevision: 0, vitals: { observedAt: NOW.toISOString(), pulseBpm: 72 },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.encounter.vitals.recordedByDisplayName, 'Demo Receptionist');
  assert.equal(first.body.encounter.note, undefined);
  assert.equal(first.body.encounter.medications, undefined);
  assert.equal((await world.call('POST', `${consultationBase}/read`, selected, doctorSession))
    .body.encounter.vitals.pulseBpm, 72);
  assert.equal((await world.call('POST', `${consultationBase}/draft`, {
    ...selected, expectedRevision: 1, note, medications,
  })).status, 403);
  assert.equal((await world.call('POST', `${consultationBase}/medicines/search`, { query: 'Demo' })).status, 403);
  assert.equal((await world.call('POST', `${consultationBase}/history/list`, selected)).status, 403);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/consultations/read`, selected)).status, 403);

  const draft = await world.call('POST', `${consultationBase}/draft`, {
    ...selected, expectedRevision: 1, note, medications,
  }, doctorSession);
  assert.equal(draft.status, 200);
  assert.equal((await world.call('POST', `${consultationBase}/vitals`, {
    ...selected, expectedRevision: 1, vitals: { observedAt: NOW.toISOString(), pulseBpm: 74 },
  })).status, 409);
  const receptionRead = await world.call('POST', `${consultationBase}/read`, selected);
  assert.equal(receptionRead.body.encounter.revision, 2);
  assert.equal(receptionRead.body.encounter.note, undefined);
  assert.equal(receptionRead.body.printablePrescription, undefined);

  world.members.get('goodwell/reception').role = 'clinic_admin';
  const adminSaved = await world.call('POST', `${consultationBase}/vitals`, {
    ...selected, expectedRevision: 2, vitals: { observedAt: NOW.toISOString(), pulseBpm: 74 },
  });
  assert.equal(adminSaved.status, 200);
  const doctorRead = await world.call('POST', `${consultationBase}/read`, selected, doctorSession);
  assert.equal(doctorRead.body.encounter.vitals.pulseBpm, 74);
  assert.equal(doctorRead.body.encounter.note.assessment, note.assessment);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`, {
    ...selected, expectedRevision: 3,
  })).status, 403);
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
  world.members.get('goodwell/doctor1').displayName = 'D'.repeat(161);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 2 }, doctorSession)).status, 503);
  world.members.get('goodwell/doctor1').displayName = 'Dr One';
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
  assert.equal(world.history.size, 1);
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

test('assigned doctor reads only earlier finalized history for the same clinic patient', async () => {
  const world = setup();
  const p1 = (await world.call('POST', `${ROOT}/goodwell/patients`, patient)).body.patient.id;
  const p2 = (await world.call('POST', `${ROOT}/goodwell/patients`,
    { ...patient, fullName: 'Second Fictional Patient', phone: '+91 98765 43211' })).body.patient.id;
  const prior = await bookFor(world, p1, 'd2', '2026-10-10T09:30:00+05:30');
  const draftOnly = await bookFor(world, p1, 'd2', '2026-10-10T10:00:00+05:30');
  const otherPatient = await bookFor(world, p2, 'd2', '2026-10-10T10:30:00+05:30');
  const selected = await bookFor(world, p1, 'd1', '2026-10-10T11:00:00+05:30');
  const sameTime = await bookFor(world, p1, 'd2', '2026-10-10T11:00:00+05:30');
  const later = await bookFor(world, p1, 'd2', '2026-10-10T11:30:00+05:30');
  await finalizeFor(world, prior, otherDoctorSession);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...draftOnly, expectedRevision: 0, note, medications }, otherDoctorSession)).status, 200);
  await finalizeFor(world, otherPatient, otherDoctorSession);
  await finalizeFor(world, sameTime, otherDoctorSession);
  await finalizeFor(world, later, otherDoctorSession);
  await finalizeFor(world, selected, doctorSession);
  const path = `${consultationBase}/history/list`;
  const listed = await world.call('POST', path, selected, doctorSession);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers['cache-control'], 'no-store');
  assert.equal(listed.body.coverage, 'indexed_finalizations_only');
  assert.equal(listed.body.nextCursor, null);
  assert.equal(listed.body.items.length, 1);
  const item = listed.body.items[0];
  assert.equal(item.patientId, p1);
  assert.equal(item.clinicSlug, 'goodwell');
  assert.equal(item.status, 'finalized');
  assert.equal(item.visitAt, '2026-10-10T09:30:00+05:30');
  assert.deepEqual(item.doctor, { id: 'd2', displayName: 'Dr Two' });
  const detailPath = `${consultationBase}/history/detail`;
  const detail = await world.call('POST', detailPath,
    { ...selected, historyId: item.historyId }, doctorSession);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.history.status, 'finalized');
  assert.equal(detail.body.history.patientId, p1);
  assert.deepEqual(detail.body.history.note, note);
  assert.equal(detail.body.history.medications[0].dose, '1 tablet');
  assert.equal(detail.body.history.vitals, null);
  world.doctors.get('goodwell')[1].displayName = 'Renamed Doctor';
  world.members.get('goodwell/doctor2').displayName = 'Renamed Account';
  assert.deepEqual((await world.call('POST', detailPath,
    { ...selected, historyId: item.historyId }, doctorSession)).body.history.doctor,
  { id: 'd2', displayName: 'Dr Two' });

  const allIds = [...world.history.values()];
  const idFor = (appointmentId) => allIds.find((row) => row.appointmentId === appointmentId)?.historyId;
  for (const historyId of [idFor(otherPatient.appointmentId), idFor(sameTime.appointmentId),
    idFor(later.appointmentId),
    idFor(selected.appointmentId), historyIdFor('2026-10-10T04:30:00.000Z', draftOnly.appointmentId)]) {
    assert.equal((await world.call('POST', detailPath,
      { ...selected, historyId }, doctorSession)).status, 404);
  }
  assert.equal((await world.call('POST', path, selected, otherDoctorSession)).status, 403);
  assert.equal((await world.call('POST', path, selected, nurseSession)).status, 403);
  assert.equal((await world.call('POST', path, selected)).status, 403);
  assert.equal((await world.call('POST', detailPath,
    { ...selected, historyId: item.historyId }, nurseSession)).status, 403);
  assert.equal((await world.call('POST', detailPath,
    { ...selected, historyId: item.historyId })).status, 403);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/consultations/history/list`,
    selected, doctorSession)).status, 403);
  const blessCookie = 'b'.repeat(43);
  world.sessions.set(createHash('sha256').update(blessCookie).digest('hex'), {
    clinicSlug: 'blesswell', username: 'blessdoctor', sub: 'bless-doctor-sub', csrfToken: CSRF,
    expiresAt: Math.floor(NOW.getTime() / 1000) + 3600,
  });
  world.members.set('blesswell/blessdoctor', { clinicSlug: 'blesswell', username: 'blessdoctor',
    cognitoUsername: 'internal-bless-doctor', sub: 'bless-doctor-sub', displayName: 'Blesswell Doctor',
    role: 'doctor', active: true });
  world.doctors.get('blesswell')[0].staffSub = 'bless-doctor-sub';
  world.patients.set('blesswell', new Map([[p1, { ...world.patients.get('goodwell').get(p1) }]]));
  world.appointments.set('blesswell', [{ ...world.appointments.get('goodwell')
    .find((row) => row.id === selected.appointmentId), doctorId: 'd1' }]);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/consultations/history/detail`,
    { ...selected, historyId: item.historyId },
    { cookies: [`__Host-cpz_session=${blessCookie}`] })).status, 404);
  assert.equal((await world.call('POST', path, selected,
    { ...doctorSession, headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  assert.equal((await world.call('POST', detailPath, { ...selected, historyId: item.historyId },
    { ...doctorSession, headers: { origin: 'https://wrong.example' } })).status, 403);
  world.modules.get('goodwell').consultations = false;
  assert.equal((await world.call('POST', path, selected, doctorSession)).status, 403);
  world.modules.get('goodwell').consultations = true;
  world.doctors.get('goodwell')[0].staffSub = 'doctor-sub-2';
  assert.equal((await world.call('POST', detailPath,
    { ...selected, historyId: item.historyId }, doctorSession)).status, 403);
  assert.equal((await world.call('POST', `${consultationBase}/read`, selected, otherDoctorSession)).status, 403);
  assert.equal((await world.call('POST', path, selected, otherDoctorSession)).status, 403);
  assert.equal((await world.call('POST', detailPath,
    { ...selected, historyId: item.historyId }, otherDoctorSession)).status, 403);
  world.doctors.get('goodwell')[0].staffSub = 'doctor-sub-1';
  world.sessions.get(createHash('sha256').update(DOCTOR_COOKIE).digest('hex')).expiresAt =
    Math.floor(NOW.getTime() / 1000);
  assert.equal((await world.call('POST', path, selected, doctorSession)).status, 401);
});

test('history pagination is bounded, ordered by visit time, and binds cursors to the selected visit', async () => {
  const world = setup();
  const patientId = (await world.call('POST', `${ROOT}/goodwell/patients`, patient)).body.patient.id;
  const selected = await bookFor(world, patientId, 'd1', '2026-10-10T18:00:00+05:30');
  for (let slot = 0; slot < 16; slot += 1) {
    const minute = 9 * 60 + 30 + slot * 30;
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const visit = await bookFor(world, patientId, 'd1', `2026-10-10T${time}:00+05:30`);
    await finalizeFor(world, visit, doctorSession);
  }
  const path = `${consultationBase}/history/list`;
  const first = await world.call('POST', path, selected, doctorSession);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 10);
  assert.equal(typeof first.body.nextCursor, 'string');
  const second = await world.call('POST', path, { ...selected, cursor: first.body.nextCursor }, doctorSession);
  assert.equal(second.status, 200);
  assert.equal(second.body.items.length, 6);
  assert.equal(second.body.nextCursor, null);
  const ids = [...first.body.items, ...second.body.items].map((row) => row.historyId);
  assert.equal(new Set(ids).size, 16);
  assert.deepEqual(ids, [...ids].sort().reverse());
  assert.equal((await world.call('POST', path,
    { ...selected, cursor: `${first.body.nextCursor}x` }, doctorSession)).status, 400);
  const alternate = await bookFor(world, patientId, 'd1', '2026-10-11T18:00:00+05:30');
  assert.equal((await world.call('POST', path,
    { ...alternate, cursor: first.body.nextCursor }, doctorSession)).status, 400);
  assert.equal((await world.call('POST', path, { ...selected, cursor: 'forged' }, doctorSession)).status, 400);
  assert.equal((await world.call('POST', path, { ...selected, patientId }, doctorSession)).status, 400);
});

test('legacy finalized encounters without a history pointer need backfill and are not guessed by a scan', async () => {
  const world = setup();
  const patientId = (await world.call('POST', `${ROOT}/goodwell/patients`, patient)).body.patient.id;
  const prior = await bookFor(world, patientId, 'd2', '2026-10-10T09:30:00+05:30');
  const selected = await bookFor(world, patientId, 'd1', '2026-10-10T10:00:00+05:30');
  await finalizeFor(world, prior, otherDoctorSession);
  const [pointerKey, pointer] = [...world.history.entries()][0];
  world.history.delete(pointerKey);
  const listed = await world.call('POST', `${consultationBase}/history/list`, selected, doctorSession);
  assert.deepEqual(listed.body.items, []);
  assert.equal(listed.body.coverage, 'indexed_finalizations_only');
  assert.equal((await world.call('POST', `${consultationBase}/history/detail`,
    { ...selected, historyId: pointer.historyId }, doctorSession)).status, 404);
});

test('a corrupt history pointer cannot expose draft or another patient’s canonical encounter', async () => {
  const world = setup();
  const p1 = (await world.call('POST', `${ROOT}/goodwell/patients`, patient)).body.patient.id;
  const p2 = (await world.call('POST', `${ROOT}/goodwell/patients`,
    { ...patient, fullName: 'Other Fictional Patient', phone: '+91 98765 43212' })).body.patient.id;
  const old = await bookFor(world, p2, 'd2', '2026-10-10T09:30:00+05:30');
  const selected = await bookFor(world, p1, 'd1', '2026-10-10T10:00:00+05:30');
  const draft = await world.call('POST', `${consultationBase}/draft`,
    { ...old, expectedRevision: 0, note, medications }, otherDoctorSession);
  assert.equal(draft.status, 200);
  const historicalAppointment = world.appointments.get('goodwell').find((row) => row.id === old.appointmentId);
  const historyId = historyIdFor(historicalAppointment.startUtc, old.appointmentId);
  world.history.set(`goodwell/${p1}/${historyId}`, { historyId, clinicSlug: 'goodwell', patientId: p1,
    appointmentId: old.appointmentId, clinicDate: old.clinicDate,
    visitAt: historicalAppointment.startAt, visitUtc: historicalAppointment.startUtc,
    status: 'finalized', finalizedAt: NOW.toISOString(), doctor: { id: 'd2', displayName: 'Dr Two' } });
  assert.equal((await world.call('POST', `${consultationBase}/history/list`, selected, doctorSession)).status, 503);
  assert.equal((await world.call('POST', `${consultationBase}/history/detail`,
    { ...selected, historyId }, doctorSession)).status, 404);
});

test('doctor-entered structured timing can replace frequency while legacy records display timing null', async () => {
  const world = setup();
  const patientId = (await world.call('POST', `${ROOT}/goodwell/patients`, patient)).body.patient.id;
  const selected = await bookFor(world, patientId, 'd1', '2026-10-10T10:00:00+05:30');
  const timed = { ...medications[0], frequency: '',
    timing: { timesOfDay: ['morning', 'night'] } };
  for (const badTiming of [
    { timesOfDay: [] }, { timesOfDay: ['morning', 'morning'] },
    { timesOfDay: ['midnight'] }, { timesOfDay: ['night'], mealRelation: 'unknown' },
    { timesOfDay: ['night'], mealRelation: null },
    { timesOfDay: ['night'], mealRelation: 'after', extra: true },
  ]) {
    assert.equal((await world.call('POST', `${consultationBase}/draft`,
      { ...selected, expectedRevision: 0, note, medications: [{ ...timed, timing: badTiming }] }, doctorSession)).status, 400);
  }
  const draft = await world.call('POST', `${consultationBase}/draft`,
    { ...selected, expectedRevision: 0, note, medications: [timed] }, doctorSession);
  assert.equal(draft.status, 200);
  assert.deepEqual(draft.body.encounter.medications[0].timing,
    { timesOfDay: ['morning', 'night'], mealRelation: 'unspecified' });
  assert.equal(draft.body.encounter.medications[0].frequency, '');
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...selected, expectedRevision: 1 }, doctorSession)).status, 200);

  const old = await bookFor(world, patientId, 'd1', '2026-10-10T11:00:00+05:30');
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...old, expectedRevision: 0, note, medications }, doctorSession)).status, 200);
  const oldStored = world.encounters.get(`goodwell/${old.clinicDate}/${old.appointmentId}`);
  delete oldStored.medications[0].timing;
  const oldRead = await world.call('POST', `${consultationBase}/read`, old, doctorSession);
  assert.equal(oldRead.body.encounter.medications[0].timing, null);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...old, expectedRevision: 1 }, doctorSession)).status, 200);

  const conflicting = await bookFor(world, patientId, 'd1', '2026-10-10T12:00:00+05:30');
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...conflicting, expectedRevision: 0, note,
      medications: [{ ...medications[0], timing: { timesOfDay: ['morning'], mealRelation: 'with' } }] }, doctorSession)).status, 200);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...conflicting, expectedRevision: 1 }, doctorSession)).status, 400);
});

test('reception, clinic admin, and pharmacy can see only finalized prescription handoff', async () => {
  const world = setup();
  const patientId = (await world.call('POST', `${ROOT}/goodwell/patients`, patient)).body.patient.id;
  const withRx = await bookFor(world, patientId, 'd1', '2026-10-10T10:00:00+05:30');
  const draftOnly = await bookFor(world, patientId, 'd1', '2026-10-10T11:00:00+05:30');
  const withoutRx = await bookFor(world, patientId, 'd1', '2026-10-10T12:00:00+05:30');
  await finalizeFor(world, withRx);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...draftOnly, expectedRevision: 0, note, medications }, doctorSession)).status, 200);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...withoutRx, expectedRevision: 0, note, medications: [] }, doctorSession)).status, 200);
  assert.equal((await world.call('POST', `${consultationBase}/finalize`,
    { ...withoutRx, expectedRevision: 1 }, doctorSession)).status, 200);
  const queuePath = `${consultationBase}/prescriptions`;
  const detailPath = `${queuePath}/read`;
  for (const staff of [{}, pharmacistSession]) {
    const queue = await world.call('GET', queuePath, undefined, { ...staff, queryString: 'date=2026-10-10' });
    assert.equal(queue.status, 200);
    assert.deepEqual(queue.body.items.map((item) => item.appointmentId), [withRx.appointmentId]);
    assert.deepEqual(Object.keys(queue.body.items[0]).sort(),
      ['appointmentId', 'clinicDate', 'doctorId', 'doctorName', 'finalizedAt', 'patientId', 'patientName', 'startAt'].sort());
    const detail = await world.call('POST', detailPath, withRx, staff);
    assert.equal(detail.status, 200);
    assert.deepEqual(Object.keys(detail.body).sort(), ['printablePrescription', 'status']);
    assert.equal(detail.body.status, 'finalized');
    assert.equal(detail.body.printablePrescription.medications[0].timing, null);
    assert.equal(detail.body.printablePrescription.patient.phone, undefined);
    assert.equal(detail.body.printablePrescription.patient.email, undefined);
    assert.equal(detail.body.encounter, undefined);
    assert.equal((await world.call('POST', detailPath, draftOnly, staff)).status, 404);
    assert.equal((await world.call('POST', detailPath, withoutRx, staff)).status, 404);
    const vitalsRead = await world.call('POST', `${consultationBase}/read`, withRx, staff);
    assert.equal(vitalsRead.status, staff === pharmacistSession ? 403 : 200);
    if (staff !== pharmacistSession) {
      assert.equal(vitalsRead.body.encounter.note, undefined);
      assert.equal(vitalsRead.body.encounter.medications, undefined);
    }
    assert.equal((await world.call('POST', `${consultationBase}/history/list`, withRx, staff)).status, 403);
    assert.equal((await world.call('POST', `${consultationBase}/vitals`,
      { ...withRx, expectedRevision: 2, vitals: { observedAt: NOW.toISOString(), pulseBpm: 72 } }, staff)).status,
      staff === pharmacistSession ? 403 : 409);
    assert.equal((await world.call('POST', `${consultationBase}/draft`,
      { ...withRx, expectedRevision: 2, note, medications }, staff)).status, 403);
  }
  assert.equal((await world.call('GET', queuePath, undefined,
    { ...doctorSession, queryString: 'date=2026-10-10' })).status, 403);
  assert.equal((await world.call('POST', detailPath, withRx, nurseSession)).status, 403);
  world.members.get('goodwell/reception').role = 'clinic_admin';
  const adminQueue = await world.call('GET', queuePath, undefined, { queryString: 'date=2026-10-10' });
  assert.equal(adminQueue.status, 200);
  assert.deepEqual(adminQueue.body.items.map((item) => item.appointmentId), [withRx.appointmentId]);
  const adminDetail = await world.call('POST', detailPath, withRx);
  assert.equal(adminDetail.status, 200);
  assert.equal(adminDetail.body.printablePrescription.patient.phone, undefined);
  assert.equal(adminDetail.body.printablePrescription.patient.email, undefined);
  assert.equal(adminDetail.body.encounter, undefined);
  assert.equal((await world.call('POST', detailPath, draftOnly)).status, 404);
  const adminVitalsRead = await world.call('POST', `${consultationBase}/read`, withRx);
  assert.equal(adminVitalsRead.status, 200);
  assert.equal(adminVitalsRead.body.encounter.note, undefined);
  assert.equal(adminVitalsRead.body.encounter.medications, undefined);
  assert.equal((await world.call('POST', `${consultationBase}/draft`,
    { ...withRx, expectedRevision: 2, note, medications })).status, 403);
});

test('prescription handoff checks session, clinic, entitlement, CSRF and canonical record linkage', async () => {
  const world = setup();
  const selected = await seedAppointment(world);
  await finalizeFor(world, selected);
  const queuePath = `${consultationBase}/prescriptions`;
  const detailPath = `${queuePath}/read`;
  assert.equal((await world.call('GET', queuePath, undefined,
    { queryString: 'date=2026-10-10', cookies: [] })).status, 401);
  assert.equal((await world.call('GET', `${ROOT}/blesswell/consultations/prescriptions`, undefined,
    { ...pharmacistSession, queryString: 'date=2026-10-10' })).status, 403);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/consultations/prescriptions/read`,
    selected)).status, 403);
  assert.equal((await world.call('GET', queuePath, undefined, { ...pharmacistSession, queryString: '' })).status, 400);
  assert.equal((await world.call('POST', detailPath, { ...selected, patientId: 'forged' }, pharmacistSession)).status, 400);
  assert.equal((await world.call('POST', detailPath, selected,
    { ...pharmacistSession, headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  assert.equal((await world.call('POST', detailPath, selected,
    { ...pharmacistSession, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await world.call('POST', detailPath, selected,
    { ...pharmacistSession, headers: { 'x-clinicpluz-edge-key': 'wrong' } })).status, 403);
  world.modules.get('goodwell').consultations = false;
  assert.equal((await world.call('POST', detailPath, selected, pharmacistSession)).status, 403);
  world.modules.get('goodwell').consultations = true;
  const session = world.sessions.get(createHash('sha256').update(PHARMACIST_COOKIE).digest('hex'));
  session.expiresAt = Math.floor(NOW.getTime() / 1000);
  assert.equal((await world.call('POST', detailPath, selected, pharmacistSession)).status, 401);
  session.expiresAt += 3600;
  const encounter = world.encounters.get(`goodwell/${selected.clinicDate}/${selected.appointmentId}`);
  encounter.patientId = 'other-patient';
  assert.equal((await world.call('POST', detailPath, selected, pharmacistSession)).status, 503);
  assert.equal((await world.call('GET', queuePath, undefined,
    { ...pharmacistSession, queryString: 'date=2026-10-10' })).status, 503);
});

test('demo email is disabled by default and preview requires reception and a finalized prescription', async () => {
  const world = setup();
  const selected = await seedAppointment(world);
  const previewPath = `${consultationBase}/prescriptions/email/preview`;
  assert.equal((await world.call('POST', previewPath, selected)).status, 503);
  assert.equal((await world.call('POST', previewPath, selected, pharmacistSession)).status, 403);
  assert.equal(world.deliveries.size, 0);
  const enabled = setup({ prescriptionEmail: { allowedRecipient: patient.email,
    async send() { throw new Error('Should not send during preview'); } } });
  const draft = await seedAppointment(enabled);
  assert.equal((await enabled.call('POST', previewPath, draft)).status, 404);
  await finalizeFor(enabled, draft);
  const preview = await enabled.call('POST', previewPath, draft);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.recipientEmail, patient.email);
  assert.equal(preview.body.recipientMasked, 'a***@example.test');
  assert.equal(preview.headers['cache-control'], 'no-store');
  enabled.members.get('goodwell/reception').role = 'clinic_admin';
  const adminPreview = await enabled.call('POST', previewPath, draft);
  assert.equal(adminPreview.status, 200);
  assert.equal(adminPreview.body.recipientEmail, patient.email);
  assert.equal(enabled.deliveries.size, 0);
});

test('reception sends one server-generated demo PDF only to confirmed stored patient email', async () => {
  const sent = [];
  const world = setup({ prescriptionEmail: { allowedRecipient: patient.email,
    async send(to, pdf) { sent.push({ to, pdf }); return 'ses-synthetic-message-1'; } } });
  const selected = await seedAppointment(world);
  await finalizeFor(world, selected);
  const path = `${consultationBase}/prescriptions/email`;
  const previewPath = `${path}/preview`;
  const request = { ...selected, expectedRecipientEmail: patient.email, confirmPatientEmail: true };
  assert.equal((await world.call('POST', path, { ...request, recipient: 'attacker@example.test' })).status, 400);
  assert.equal((await world.call('POST', path, { ...request, confirmPatientEmail: false })).status, 400);
  assert.equal((await world.call('POST', path, { ...request, expectedRecipientEmail: 'old@example.test' })).status, 409);
  assert.equal((await world.call('POST', path, request, pharmacistSession)).status, 403);
  assert.equal((await world.call('POST', path, request, doctorSession)).status, 403);
  assert.equal((await world.call('POST', path, request,
    { headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  assert.equal((await world.call('POST', `${ROOT}/blesswell/consultations/prescriptions/email`, request)).status, 403);
  assert.equal((await world.call('POST', previewPath, selected)).body.recipientEmail, patient.email);
  const first = await world.call('POST', path, request);
  assert.equal(first.status, 202);
  assert.deepEqual(first.body, { status: 'accepted', recipientMasked: 'a***@example.test' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, patient.email);
  assert.equal(Buffer.from(sent[0].pdf).subarray(0, 5).toString(), '%PDF-');
  const parsed = await PDFDocument.load(sent[0].pdf);
  assert.equal(parsed.getPageCount(), 1);
  const content = parsed.getPage(0).node.Contents();
  const operators = Array.from({ length: content.size() }, (_, index) =>
    Buffer.from(decodePDFRawStream(parsed.context.lookup(content.get(index))).decode()).toString('ascii')).join('\n');
  assert.equal(operators.includes(Buffer.from(note.assessment).toString('hex').toUpperCase()), false);
  assert.ok(operators.includes(Buffer.from('Demo Medicine').toString('hex').toUpperCase()));
  assert.equal((await world.call('POST', path, request)).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(world.deliveries.size, 1);
  assert.deepEqual(world.audit.filter((entry) => entry.action.startsWith('prescription.email.'))
    .map((entry) => entry.action), ['prescription.email.requested', 'prescription.email.accepted']);
  assert.equal(JSON.stringify(world.audit).includes(patient.email), false);
  assert.equal(JSON.stringify([...world.deliveries.entries()]).includes(patient.email), false);
});

test('email confirmation is invalidated by changed stored address, missing email, and unsupported demo glyphs', async () => {
  let sends = 0;
  const world = setup({ prescriptionEmail: { allowedRecipient: patient.email,
    async send() { sends += 1; return 'synthetic-message'; } } });
  const selected = await seedAppointment(world);
  await finalizeFor(world, selected);
  const path = `${consultationBase}/prescriptions/email`;
  const request = { ...selected, expectedRecipientEmail: patient.email, confirmPatientEmail: true };
  const patientId = world.appointments.get('goodwell')[0].patientId;
  const record = world.patients.get('goodwell').get(patientId);
  record.email = 'changed@example.test';
  assert.equal((await world.call('POST', path, request)).status, 409);
  record.email = null;
  assert.equal((await world.call('POST', `${path}/preview`, selected)).status, 409);
  record.email = patient.email;
  record.fullName = 'अमन Demo';
  const unsupported = await world.call('POST', path, request);
  assert.equal(unsupported.status, 422);
  assert.equal(sends, 0);
  assert.equal(world.deliveries.size, 0);
});

test('an email change between canonical read and atomic claim requires a new preview', async () => {
  let patientRecord;
  let sends = 0;
  const world = setup({ prescriptionEmail: { allowedRecipient: patient.email,
    async send() { sends += 1; return 'synthetic-message'; } },
    beforeEmailClaim() { patientRecord.email = 'changed@example.test'; } });
  const selected = await seedAppointment(world);
  await finalizeFor(world, selected);
  const patientId = world.appointments.get('goodwell')[0].patientId;
  patientRecord = world.patients.get('goodwell').get(patientId);
  const response = await world.call('POST', `${consultationBase}/prescriptions/email`, {
    ...selected, expectedRecipientEmail: patient.email, confirmPatientEmail: true,
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Patient email changed; review again');
  assert.equal(sends, 0);
  assert.equal(world.deliveries.size, 0);
});

test('concurrent and uncertain SES outcomes never send a second synthetic PDF automatically', async () => {
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let sends = 0;
  const world = setup({ prescriptionEmail: { allowedRecipient: patient.email,
    async send() { sends += 1; started(); await gate; throw new Error('Ambiguous SES timeout'); } } });
  const selected = await seedAppointment(world);
  await finalizeFor(world, selected);
  const path = `${consultationBase}/prescriptions/email`;
  const request = { ...selected, expectedRecipientEmail: patient.email, confirmPatientEmail: true };
  const firstPromise = world.call('POST', path, request);
  await startedPromise;
  const duplicate = await world.call('POST', path, request);
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.body.status, 'pending');
  release();
  const first = await firstPromise;
  assert.equal(first.status, 503);
  const retry = await world.call('POST', path, request);
  assert.equal(retry.status, 409);
  assert.equal(retry.body.status, 'unknown');
  assert.equal(sends, 1);
});
