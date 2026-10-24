import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import {
  chargeAmount, episodeView, receiptSnapshot, validOperationId, validPaise,
} from '../src/billing.ts';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === './prescription-pdf.ts' && context.parentURL?.endsWith('/src/core.ts')) {
    return { url: 'data:text/javascript,export async function renderPrescriptionPdf(){throw new Error("Unused in billing tests")};export class UnsupportedPrescriptionText extends Error{}', shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { createWorkflowApp } = await import('../src/core.ts');

const NOW = '2026-10-15T10:00:00.000Z';
const clinic = { slug: 'goodwell', displayName: 'Goodwell Demo Clinic', active: true };
const appointment = {
  id: 'visit-1', patientId: 'patient-1', patientName: 'Synthetic Patient',
  doctorId: 'doctor-1', doctorName: 'Dr Demo', clinicDate: '2026-10-15',
  startAt: '2026-10-15T10:00:00+05:30', startUtc: '2026-10-15T04:30:00.000Z',
  source: 'phone', status: 'checked_in', createdAt: NOW, createdBySub: 'reception-sub',
};

function episode(overrides = {}) {
  return {
    appointmentId: appointment.id, clinicDate: appointment.clinicDate,
    patientId: appointment.patientId, patientName: appointment.patientName,
    currency: 'INR', revision: 1, consultationTotalPaise: 200_000,
    pharmacyTotalPaise: 0, paidPaise: 0, pharmacyClosed: false,
    pharmacyLineCount: 0, paymentCount: 0, receiptIssued: false,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

const finalizedWithMedicine = {
  status: 'finalized', medications: [{ name: 'Synthetic tablet' }],
};
const finalizedWithoutMedicine = { status: 'finalized', medications: [] };

test('money and operation identifiers reject values that can corrupt a bill', () => {
  for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '100', 100_000_001]) {
    assert.equal(validPaise(invalid), false);
  }
  assert.equal(validPaise(0), true);
  assert.equal(validPaise(100_000_000), true);
  assert.equal(chargeAmount(2, 12_345), 24_690);
  for (const [quantity, price] of [[0, 100], [1.5, 100], [10_001, 100], [2, -1], [10_000, 10_000_000]]) {
    assert.equal(chargeAmount(quantity, price), null);
  }
  assert.equal(validOperationId('0f870f04-610e-4cdb-88a2-c884156d0863'), true);
  assert.equal(validOperationId('0f870f04-610e-1cdb-88a2-c884156d0863'), false);
  assert.equal(validOperationId('visit-1'), false);
});

test('fee prepayment cannot make an unfinished consultation look paid', () => {
  const prepaid = episode({ paidPaise: 200_000, paymentCount: 1 });
  const awaitingDoctor = episodeView(prepaid, appointment, null);
  assert.equal(awaitingDoctor.totalPaise, 200_000);
  assert.equal(awaitingDoctor.outstandingPaise, 0);
  assert.equal(awaitingDoctor.checkoutStatus, 'awaiting_consultation');
  assert.equal(awaitingDoctor.receiptIssued, false);

  const awaitingPharmacy = episodeView(prepaid, appointment, finalizedWithMedicine);
  assert.equal(awaitingPharmacy.checkoutStatus, 'awaiting_pharmacy');
  assert.equal(awaitingPharmacy.pharmacyDisposition, 'awaiting');

  const feeOnly = episodeView(prepaid, appointment, finalizedWithoutMedicine);
  assert.equal(feeOnly.checkoutStatus, 'ready_for_checkout');
  assert.equal(feeOnly.pharmacyDisposition, 'not_required');
});

test('actual partial supply increases the open balance without changing the fee prepayment', () => {
  const supplied = episode({ revision: 2, pharmacyTotalPaise: 45_000,
    paidPaise: 200_000, pharmacyClosed: true, pharmacyLineCount: 1, paymentCount: 1 });
  const view = episodeView(supplied, appointment, finalizedWithMedicine);
  assert.equal(view.consultationTotalPaise, 200_000);
  assert.equal(view.pharmacyTotalPaise, 45_000);
  assert.equal(view.totalPaise, 245_000);
  assert.equal(view.outstandingPaise, 45_000);
  assert.equal(view.checkoutStatus, 'partly_paid');
  assert.equal(view.pharmacyDisposition, 'closed');
  assert.equal(view.receiptIssued, false);

  assert.throws(() => episodeView(episode({ pharmacyTotalPaise: 45_000,
    paidPaise: 200_000, receiptIssued: true, pharmacyClosed: false }),
  appointment, finalizedWithMedicine), /Invalid issued receipt state/);
});

test('receipt freezes settled charge and payment snapshots', () => {
  const settled = episode({ revision: 3, pharmacyTotalPaise: 45_000,
    paidPaise: 245_000, pharmacyClosed: true, pharmacyLineCount: 1,
    paymentCount: 2, receiptIssued: true });
  const charges = [
    { id: 'consultation', kind: 'consultation', description: 'Consultation', quantity: 1,
      quantityUnit: 'visit', unitPricePaise: 200_000, amountPaise: 200_000,
      source: 'clinic_config', createdAt: NOW, actorSub: 'reception-sub' },
    { id: 'fill-1', kind: 'pharmacy', description: 'Synthetic tablet', quantity: 3,
      quantityUnit: 'tablet', unitPricePaise: 15_000, amountPaise: 45_000,
      source: 'pharmacy_manual', createdAt: NOW, actorSub: 'pharmacy-sub' },
  ];
  const payments = [
    { id: 'payment-1', amountPaise: 200_000, method: 'cash', reference: null,
      recordedAt: NOW, actorSub: 'reception-sub' },
    { id: 'payment-2', amountPaise: 45_000, method: 'upi', reference: null,
      recordedAt: NOW, actorSub: 'reception-sub' },
  ];
  const receipt = receiptSnapshot('demo-receipt-1', settled, appointment, clinic,
    charges, payments, NOW, 'reception-sub');
  assert.equal(receipt.label, 'SYNTHETIC DEMO RECEIPT');
  assert.deepEqual(receipt.clinic, { slug: 'goodwell', displayName: 'Goodwell Demo Clinic' });
  assert.equal(receipt.totalPaise, 245_000);
  assert.equal(receipt.paidPaise, 245_000);
  assert.equal(receipt.outstandingPaise, 0);
  charges[1].description = 'changed later';
  payments[1].amountPaise = 1;
  assert.equal(receipt.charges[1].description, 'Synthetic tablet');
  assert.equal(receipt.payments[1].amountPaise, 45_000);

  assert.throws(() => receiptSnapshot('bad', settled, appointment, clinic,
    charges, payments, NOW, 'reception-sub'), /Receipt balance is not settled/);
});

const ORIGIN = 'https://example123.cloudfront.net';
const EDGE_KEY = 'e'.repeat(48);
const CSRF = 'synthetic-billing-csrf';
const COOKIES = {
  reception: 'r'.repeat(43), admin: 'a'.repeat(43), pharmacist: 'p'.repeat(43),
  doctor: 'd'.repeat(43), nurse: 'n'.repeat(43), billing: 'b'.repeat(43),
};
const API = '/api/workflow/clinics/goodwell';
const IDS = {
  checkIn: '11111111-1111-4111-8111-111111111111',
  fee: '88888888-8888-4888-8888-888888888888',
  duplicateCheckIn: '22222222-2222-4222-8222-222222222222',
  prepayment: '33333333-3333-4333-8333-333333333333',
  fulfillment: '44444444-4444-4444-8444-444444444444',
  balancePayment: '55555555-5555-4555-8555-555555555555',
  receipt: '66666666-6666-4666-8666-666666666666',
  secondReceipt: '77777777-7777-4777-8777-777777777777',
};
const selected = { appointmentId: appointment.id, clinicDate: appointment.clinicDate };

function setupBilling() {
  const sessions = new Map();
  const members = new Map();
  for (const [role, cookie] of Object.entries(COOKIES)) {
    const username = role;
    const sub = `${role}-sub`;
    sessions.set(createHash('sha256').update(cookie).digest('hex'), {
      clinicSlug: 'goodwell', username, sub, csrfToken: CSRF,
      expiresAt: Math.floor(Date.parse(NOW) / 1000) + 3600,
    });
    members.set(`goodwell/${username}`, {
      clinicSlug: 'goodwell', username, cognitoUsername: `cognito-${username}`,
      sub, displayName: `Synthetic ${role}`, role: role === 'admin' ? 'clinic_admin' :
        role === 'reception' ? 'receptionist' : role,
      active: true,
    });
  }
  const modules = new Map([
    ['goodwell', { clinicSlug: 'goodwell', patient_intake: true, appointments: true,
      consultations: true, billing: true }],
    ['blesswell', { clinicSlug: 'blesswell', patient_intake: true, appointments: true,
      consultations: true, billing: true }],
  ]);
  const auth = {
    async getSession(hash) { return sessions.get(hash) ?? null; },
    async getClinic(slug) { return slug === 'goodwell' ? clinic :
      slug === 'blesswell' ? { slug, displayName: 'Blesswell Demo Clinic', active: true } : null; },
    async getMembership(slug, username) { return members.get(`${slug}/${username}`) ?? null; },
    async getEntitlements(slug) { return modules.get(slug) ?? null; },
  };
  const visits = new Map([['goodwell', [structuredClone({ ...appointment, status: 'booked' })]]]);
  const patient = { id: appointment.patientId, fullName: appointment.patientName,
    phone: '+91 99999 00000', ageYears: 40, sex: 'undisclosed', email: null,
    registeredAt: NOW };
  const patients = new Map([['goodwell', new Map([[patient.id, patient]])]]);
  const encounters = new Map();
  const workflow = {
    async getSchedule() { return null; },
    async listDoctors() { return [{ id: appointment.doctorId, displayName: appointment.doctorName,
      active: true, staffSub: 'doctor-sub' }]; },
    async listMedicines() { return []; },
    async getDoctor(slug, id) { return slug === 'goodwell' && id === appointment.doctorId ?
      { id, displayName: appointment.doctorName, active: true, staffSub: 'doctor-sub' } : null; },
    async searchPatients() { return []; },
    async getPatient(slug, id) { return patients.get(slug)?.get(id) ?? null; },
    async createPatient() { throw new Error('Unused in billing test'); },
    async listAppointments(slug, date) { return (visits.get(slug) ?? []).filter((row) => row.clinicDate === date); },
    async createAppointment() { throw new Error('Unused in billing test'); },
    async getEncounter(slug, date, id) { return encounters.get(`${slug}/${date}/${id}`) ?? null; },
    async listPatientHistory() { return []; },
    async getHistoryEntry() { return null; },
    async listEncounterStatuses(slug, date) { return new Map([...encounters.entries()]
      .filter(([key]) => key.startsWith(`${slug}/${date}/`))
      .map(([, encounter]) => [encounter.appointmentId, encounter.status])); },
    async saveEncounter() { throw new Error('Unused in billing test'); },
    async claimPrescriptionEmail() { throw new Error('Unused in billing test'); },
    async markPrescriptionEmail() { throw new Error('Unused in billing test'); },
  };
  const records = new Map();
  const operations = new Map();
  const audit = [];
  const config = { currency: 'INR', consultationFeePaise: 200_000, version: 1 };
  const emptyRecords = () => ({ episode: null, charges: [], payments: [], fulfillment: [], receipt: null });
  const billStore = {
    async getConfig() { return structuredClone(config); },
    async listEpisodes(slug, date) { return [...records.entries()]
      .filter(([key, value]) => key.startsWith(`${slug}/`) && value.episode?.clinicDate === date)
      .map(([, value]) => structuredClone(value.episode)); },
    async load(slug, id) { return structuredClone(records.get(`${slug}/${id}`) ?? emptyRecords()); },
    async getOperation(slug, id, operationId) {
      return structuredClone(operations.get(`${slug}/${id}/${operationId}`) ?? null);
    },
    async commit(slug, write) {
      const key = `${slug}/${write.appointment.id}`;
      const opKey = `${key}/${write.operation.id}`;
      const current = records.get(key) ?? emptyRecords();
      const storedVisit = (visits.get(slug) ?? []).find((row) => row.id === write.appointment.id);
      if (!storedVisit || storedVisit.patientId !== write.appointment.patientId ||
          storedVisit.doctorId !== write.appointment.doctorId ||
          (current.episode?.revision ?? 0) !== write.previousRevision ||
          operations.has(opKey)) return false;
      if (write.checkInBooked && storedVisit.status !== 'booked') return false;
      if (write.requireCheckedIn && storedVisit.status !== 'checked_in') return false;
      if (write.configVersion !== undefined && write.configVersion !== config.version) return false;
      if (write.doctorStaffSub && write.doctorStaffSub !== 'doctor-sub') return false;
      if (write.encounterRevision !== undefined) {
        const canonical = encounters.get(`${slug}/${storedVisit.clinicDate}/${storedVisit.id}`);
        if (canonical?.status !== 'finalized' || canonical.revision !== write.encounterRevision ||
            canonical.patientId !== storedVisit.patientId || canonical.doctorId !== storedVisit.doctorId) return false;
      }
      if (write.receipt && current.receipt) return false;
      if (write.checkInBooked) storedVisit.status = 'checked_in';
      records.set(key, {
        episode: structuredClone(write.nextEpisode),
        charges: [...current.charges, ...(write.charges ?? [])].map((row) => structuredClone(row)),
        payments: [...current.payments, ...(write.payment ? [write.payment] : [])].map((row) => structuredClone(row)),
        fulfillment: [...current.fulfillment, ...(write.fulfillment ? [write.fulfillment] : [])].map((row) => structuredClone(row)),
        receipt: write.receipt ? structuredClone(write.receipt) : current.receipt,
      });
      operations.set(opKey, structuredClone(write.operation));
      audit.push({ kind: write.operation.kind, slug, appointmentId: storedVisit.id,
        revision: write.nextEpisode.revision, actorSub: write.actorSub });
      return true;
    },
  };
  const app = createWorkflowApp(auth, { async isActive() { return true; } }, workflow,
    { publicOrigin: ORIGIN, edgeKey: EDGE_KEY, now: () => new Date(NOW) }, billStore);
  async function call(method, path, payload, { role = 'reception', headers = {}, queryString = '' } = {}) {
    const response = await app.handle({ method, path, queryString,
      headers: { 'x-clinicpluz-edge-key': EDGE_KEY,
        ...(method === 'POST' ? { origin: ORIGIN, 'x-csrf-token': CSRF,
          'content-type': 'application/json' } : {}), ...headers },
      cookies: [`__Host-cpz_session=${COOKIES[role]}`],
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  }
  function finalize() {
    const canonical = {
      appointmentId: appointment.id, clinicDate: appointment.clinicDate,
      patientId: appointment.patientId, doctorId: appointment.doctorId,
      status: 'finalized', revision: 2,
      vitals: null, note: { chiefComplaint: '', history: '', exam: '',
        assessment: 'Synthetic assessment', plan: 'Synthetic plan' },
      medications: [
        { name: 'Synthetic tablet', strength: '5 mg', dose: '1 tablet', route: 'oral',
          frequency: 'daily', timing: null, duration: '3 days', instructions: 'After food',
          prescriberSub: 'doctor-sub', encounterAppointmentId: appointment.id, orderedAt: NOW },
        { name: 'Synthetic capsule', strength: '10 mg', dose: '1 capsule', route: 'oral',
          frequency: 'daily', timing: null, duration: '3 days', instructions: 'After food',
          prescriberSub: 'doctor-sub', encounterAppointmentId: appointment.id, orderedAt: NOW },
      ],
      noteAuthorSub: 'doctor-sub', updatedAt: NOW, finalizedAt: NOW,
      finalizedBySub: 'doctor-sub', finalizedByDisplayName: 'Dr Demo',
      finalizedDoctorId: appointment.doctorId,
    };
    encounters.set(`goodwell/${appointment.clinicDate}/${appointment.id}`, canonical);
    return canonical;
  }
  return { call, config, modules, members, sessions, visits, encounters,
    records, operations, audit, finalize };
}

test('dashboard counts clinic visits while doctor sees only assigned visits', async () => {
  const world = setupBilling();
  world.visits.get('goodwell').push({ ...appointment, id: 'visit-2', doctorId: 'other-doctor',
    status: 'checked_in', source: 'walk_in' });
  const reception = await world.call('GET', `${API}/dashboard`, undefined,
    { queryString: 'date=2026-10-15' });
  assert.equal(reception.status, 200);
  assert.deepEqual(reception.body.counts, { total: 2, booked: 1, checkedIn: 1,
    pending: 1, completed: 0, phone: 1, walkIn: 1 });
  const doctor = await world.call('GET', `${API}/dashboard`, undefined,
    { role: 'doctor', queryString: 'date=2026-10-15' });
  assert.equal(doctor.status, 200);
  assert.deepEqual(doctor.body.counts, { total: 1, booked: 1, checkedIn: 0,
    pending: 0, completed: 0, phone: 1, walkIn: 0 });
  assert.equal((await world.call('GET', `${API}/dashboard`, undefined,
    { role: 'nurse', queryString: 'date=2026-10-15' })).status, 403);
  world.finalize();
  const completed = await world.call('GET', `${API}/dashboard`, undefined,
    { role: 'doctor', queryString: 'date=2026-10-15' });
  assert.equal(completed.body.counts.completed, 1);
  assert.equal(completed.body.counts.booked, 0);
});

test('doctor fee read and write fail when roster binding changes', async () => {
  const world = setupBilling();
  world.visits.get('goodwell')[0].status = 'checked_in';
  const visit = world.visits.get('goodwell')[0];
  visit.doctorId = 'other-doctor';
  const fee = { ...selected, operationId: IDS.fee, expectedRevision: 0, amountPaise: 125_000 };
  assert.equal((await world.call('POST', `${API}/billing/consultation-fee/read`, selected,
    { role: 'doctor' })).status, 403);
  assert.equal((await world.call('POST', `${API}/billing/consultation-charge`, fee,
    { role: 'doctor' })).status, 403);
  assert.equal(world.records.size, 0);
});

test('manual fee after check-in stays open through prepayment and pharmacy until settled receipt', async () => {
  const world = setupBilling();
  const checkIn = { ...selected, operationId: IDS.checkIn };
  const oldShape = await world.call('POST', `${API}/appointments/check-in`,
    { ...checkIn, expectedFeePaise: 200_000 });
  assert.equal(oldShape.status, 400);
  assert.equal(world.visits.get('goodwell')[0].status, 'booked');

  const arrived = await world.call('POST', `${API}/appointments/check-in`, checkIn);
  assert.equal(arrived.status, 200, JSON.stringify(arrived.body));
  assert.equal(arrived.body.appointment.status, 'checked_in');
  assert.equal(arrived.body.episode.consultationTotalPaise, 0);
  assert.equal(arrived.body.episode.revision, 1);
  assert.equal(arrived.body.episode.checkoutStatus, 'awaiting_fee');
  const key = `goodwell/${appointment.id}`;
  assert.equal(world.records.get(key).charges.length, 0);

  const retryCheckIn = await world.call('POST', `${API}/appointments/check-in`, checkIn);
  assert.equal(retryCheckIn.status, 200);
  assert.equal(world.records.get(key).charges.length, 0);
  assert.equal(world.records.get(key).episode.revision, 1);
  assert.equal((await world.call('POST', `${API}/appointments/check-in`,
    { ...checkIn, operationId: IDS.duplicateCheckIn })).status, 409);
  assert.equal(world.records.get(key).charges.length, 0);

  const fee = await world.call('POST', `${API}/billing/consultation-charge`,
    { ...selected, operationId: IDS.fee, expectedRevision: 1, amountPaise: 200_000 });
  assert.equal(fee.status, 200, JSON.stringify(fee.body));
  assert.equal(fee.body.episode.revision, 2);
  assert.equal(world.records.get(key).charges[0].source, 'staff_manual');

  const prepaid = await world.call('POST', `${API}/billing/payments`,
    { ...selected, operationId: IDS.prepayment, expectedRevision: 2,
      amountPaise: 200_000, method: 'upi', reference: 'SYNTHETIC-REF-1' });
  assert.equal(prepaid.status, 200, JSON.stringify(prepaid.body));
  assert.equal(prepaid.body.episode.paidPaise, 200_000);
  assert.equal(prepaid.body.episode.outstandingPaise, 0);
  assert.equal(prepaid.body.episode.checkoutStatus, 'awaiting_consultation');
  assert.equal((await world.call('POST', `${API}/billing/receipt`,
    { ...selected, operationId: IDS.receipt, expectedRevision: 3 })).status, 409);

  const encounter = world.finalize();
  const handoff = await world.call('POST', `${API}/billing/fulfillment/read`, selected,
    { role: 'pharmacist' });
  assert.equal(handoff.status, 200, JSON.stringify(handoff.body));
  assert.equal(handoff.body.prescriptionRevision, encounter.revision);
  assert.equal(handoff.body.items.length, 2);
  assert.equal(handoff.body.items[0].suppliedQuantity, 0);
  assert.equal(handoff.body.episode.checkoutStatus, 'awaiting_pharmacy');

  const filled = await world.call('POST', `${API}/billing/fulfillment`,
    { ...selected, operationId: IDS.fulfillment, expectedRevision: 3,
      prescriptionRevision: encounter.revision,
      items: [{ prescriptionIndex: 0, quantity: 3, quantityUnit: 'tablet',
        unitPricePaise: 15_000, status: 'partly_supplied' }], closeForCheckout: true },
    { role: 'pharmacist' });
  assert.equal(filled.status, 200, JSON.stringify(filled.body));
  assert.equal(filled.body.episode.consultationTotalPaise, 200_000);
  assert.equal(filled.body.episode.pharmacyTotalPaise, 45_000);
  assert.equal(filled.body.episode.outstandingPaise, 45_000);
  assert.equal(filled.body.episode.checkoutStatus, 'partly_paid');
  assert.equal(world.records.get(key).charges.length, 2);
  assert.equal(world.records.get(key).charges[1].prescriptionIndex, 0);
  assert.equal(world.records.get(key).charges[1].amountPaise, 45_000);
  assert.equal((await world.call('POST', `${API}/billing/receipt`,
    { ...selected, operationId: IDS.receipt, expectedRevision: 4 })).status, 409);

  const balance = await world.call('POST', `${API}/billing/payments`,
    { ...selected, operationId: IDS.balancePayment, expectedRevision: 4,
      amountPaise: 45_000, method: 'cash' });
  assert.equal(balance.status, 200, JSON.stringify(balance.body));
  assert.equal(balance.body.episode.outstandingPaise, 0);
  assert.equal(balance.body.episode.checkoutStatus, 'ready_for_checkout');
  const paid = await world.call('POST', `${API}/billing/receipt`,
    { ...selected, operationId: IDS.receipt, expectedRevision: 5 });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.episode.checkoutStatus, 'paid');
  assert.equal(paid.body.receipt.totalPaise, 245_000);
  assert.equal(paid.body.receipt.paidPaise, 245_000);
  assert.deepEqual(paid.body.receipt.charges.map((charge) => charge.amountPaise), [200_000, 45_000]);
  assert.deepEqual(paid.body.receipt.payments.map((payment) => payment.amountPaise), [200_000, 45_000]);
  const retryReceipt = await world.call('POST', `${API}/billing/receipt`,
    { ...selected, operationId: IDS.receipt, expectedRevision: 5 });
  assert.equal(retryReceipt.status, 200);
  assert.equal(retryReceipt.body.receipt.id, paid.body.receipt.id);
  assert.equal(world.records.get(key).episode.revision, 6);
  assert.equal((await world.call('POST', `${API}/billing/receipt`,
    { ...selected, operationId: IDS.secondReceipt, expectedRevision: 6 })).status, 409);
  assert.deepEqual(world.audit.map((event) => event.kind),
    ['check_in', 'consultation_charge', 'payment', 'fulfillment', 'payment', 'receipt']);
});

test('billing routes enforce role, tenant, entitlement, CSRF, and optimistic revision', async () => {
  const world = setupBilling();
  const checkIn = { ...selected, operationId: IDS.checkIn };
  for (const role of ['doctor', 'nurse', 'billing', 'pharmacist']) {
    assert.equal((await world.call('POST', `${API}/appointments/check-in`, checkIn,
      { role })).status, 403, role);
  }
  assert.equal((await world.call('GET', `${API}/billing/config`, undefined,
    { role: 'doctor' })).status, 403);
  assert.equal((await world.call('POST', `${API}/billing/fulfillment/read`, selected,
    { role: 'reception' })).status, 403);
  assert.equal((await world.call('POST', `${API}/billing/payments`,
    { ...selected, operationId: IDS.prepayment, expectedRevision: 1,
      amountPaise: 10_000, method: 'cash' }, { role: 'pharmacist' })).status, 403);
  assert.equal((await world.call('GET', '/api/workflow/clinics/blesswell/billing/config')).status, 403);
  assert.equal((await world.call('POST', `${API}/appointments/check-in`, checkIn,
    { headers: { 'x-csrf-token': 'wrong' } })).status, 403);
  assert.equal((await world.call('POST', `${API}/appointments/check-in`, checkIn,
    { headers: { origin: 'https://other.cloudfront.net' } })).status, 403);
  world.modules.get('goodwell').billing = false;
  assert.equal((await world.call('POST', `${API}/appointments/check-in`, checkIn)).status, 403);
  world.modules.get('goodwell').billing = true;

  assert.equal((await world.call('POST', `${API}/appointments/check-in`, checkIn)).status, 200);
  const stale = await world.call('POST', `${API}/billing/payments`,
    { ...selected, operationId: IDS.prepayment, expectedRevision: 0,
      amountPaise: 100, method: 'cash' });
  assert.equal(stale.status, 409);
  assert.equal(world.records.get(`goodwell/${appointment.id}`).payments.length, 0);
  assert.equal(world.operations.size, 1);
});

test('checked-in visit accepts one manual consultation fee from its assigned doctor', async () => {
  const world = setupBilling();
  world.visits.get('goodwell')[0].status = 'checked_in';
  const request = { ...selected, operationId: IDS.fee, expectedRevision: 0, amountPaise: 175_000 };
  assert.equal((await world.call('POST', `${API}/billing/consultation-charge`,
    { ...request, amountPaise: 0 }, { role: 'doctor' })).status, 400);
  const initial = await world.call('POST', `${API}/billing/consultation-fee/read`, selected,
    { role: 'doctor' });
  assert.deepEqual(initial.body, { amountPaise: null, revision: 0 });
  const charged = await world.call('POST', `${API}/billing/consultation-charge`, request,
    { role: 'doctor' });
  assert.equal(charged.status, 200, JSON.stringify(charged.body));
  assert.equal(charged.body.episode.consultationTotalPaise, 175_000);
  assert.equal(charged.body.episode.checkoutStatus, 'awaiting_consultation');
  assert.equal((await world.call('POST', `${API}/billing/consultation-charge`, request,
    { role: 'doctor' })).status, 200);
  assert.deepEqual((await world.call('POST', `${API}/billing/consultation-fee/read`, selected,
    { role: 'reception' })).body, { amountPaise: 175_000, revision: 1 });
  assert.equal((await world.call('POST', `${API}/billing/consultation-charge`,
    { ...request, operationId: IDS.duplicateCheckIn })).status, 409);
  assert.equal((await world.call('POST', `${API}/appointments/check-in`,
    { ...selected, operationId: IDS.duplicateCheckIn })).status, 409);
  assert.equal(world.records.get(`goodwell/${appointment.id}`).charges.length, 1);
});

test('pharmacy-first finalized legacy visit previews revision zero and still needs a manual fee', async () => {
  const world = setupBilling();
  const encounter = world.finalize();
  const handoff = await world.call('POST', `${API}/billing/fulfillment/read`, selected,
    { role: 'pharmacist' });
  assert.equal(handoff.status, 200, JSON.stringify(handoff.body));
  assert.equal(handoff.body.episode.revision, 0);
  assert.equal(handoff.body.episode.checkoutStatus, 'awaiting_fee');
  assert.equal(world.records.size, 0);

  const supplied = await world.call('POST', `${API}/billing/fulfillment`,
    { ...selected, operationId: IDS.fulfillment, expectedRevision: 0,
      prescriptionRevision: encounter.revision,
      items: [{ prescriptionIndex: 0, quantity: 1, quantityUnit: 'tablet',
        unitPricePaise: 1_000, status: 'partly_supplied' }], closeForCheckout: true },
    { role: 'pharmacist' });
  assert.equal(supplied.status, 200, JSON.stringify(supplied.body));
  assert.equal(supplied.body.episode.revision, 1);
  assert.equal(supplied.body.episode.pharmacyTotalPaise, 1_000);
  assert.equal(supplied.body.episode.checkoutStatus, 'awaiting_fee');
  assert.equal((await world.call('POST', `${API}/billing/receipt`,
    { ...selected, operationId: IDS.receipt, expectedRevision: 1 })).status, 409);

  const recovered = await world.call('POST', `${API}/billing/consultation-charge`,
    { ...selected, operationId: IDS.fee, expectedRevision: 1, amountPaise: 200_000 });
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.equal(recovered.body.episode.consultationTotalPaise, 200_000);
  assert.equal(recovered.body.episode.totalPaise, 201_000);
  assert.equal(world.visits.get('goodwell')[0].status, 'booked');
  assert.deepEqual(world.records.get(`goodwell/${appointment.id}`).charges
    .map((charge) => charge.kind), ['pharmacy', 'consultation']);
});

test('finalized consultation with no medication can issue a paid fee-only receipt', async () => {
  const world = setupBilling();
  world.finalize().medications = [];
  assert.equal((await world.call('POST', `${API}/appointments/check-in`,
    { ...selected, operationId: IDS.checkIn })).status, 200);
  assert.equal((await world.call('POST', `${API}/billing/consultation-charge`,
    { ...selected, operationId: IDS.fee, expectedRevision: 1, amountPaise: 200_000 })).status, 200);
  const paid = await world.call('POST', `${API}/billing/payments`,
    { ...selected, operationId: IDS.prepayment, expectedRevision: 2,
      amountPaise: 200_000, method: 'cash' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.episode.pharmacyDisposition, 'not_required');
  assert.equal(paid.body.episode.checkoutStatus, 'ready_for_checkout');
  const receipt = await world.call('POST', `${API}/billing/receipt`,
    { ...selected, operationId: IDS.receipt, expectedRevision: 3 });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
  assert.equal(receipt.body.receipt.totalPaise, 200_000);
  assert.equal(receipt.body.receipt.charges.length, 1);
  assert.equal(receipt.body.episode.checkoutStatus, 'paid');
});
