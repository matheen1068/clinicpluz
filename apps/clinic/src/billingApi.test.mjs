import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addConsultationCharge, BillingApiError, checkInAppointment, readConsultationFee,
  issueReceipt, listBillingEpisodes, readBillingEpisode, readFulfillment, recordFulfillment, recordPayment,
} from './billingApi.ts';

const date = '2026-10-15';
const appointmentId = 'appt_demo_1';
const operationId = 'b8ec6880-9f74-46c8-b13a-61990df7ac37';
const selection = { appointmentId, clinicDate: date };
const now = '2026-10-15T10:30:00.000Z';
const episode = { ...selection, patientId: 'patient_1', patientName: 'Synthetic Patient', currency: 'INR', revision: 2,
  consultationTotalPaise: 200000, pharmacyTotalPaise: 0, totalPaise: 200000, paidPaise: 0, outstandingPaise: 200000,
  pharmacyDisposition: 'awaiting', checkoutStatus: 'awaiting_pharmacy', receiptIssued: false, createdAt: now, updatedAt: now };
const charge = { id: 'PHARMACY#b8ec6880-9f74-46c8-b13a-61990df7ac37#0', kind: 'pharmacy', description: 'Synthetic medicine',
  quantity: 2, quantityUnit: 'tablet', unitPricePaise: 1000, amountPaise: 2000, source: 'pharmacy_manual',
  prescriptionIndex: 0, prescriptionRevision: 3, createdAt: now, actorSub: 'sub-1' };
const payment = { id: 'PAYMENT#b8ec6880-9f74-46c8-b13a-61990df7ac37', amountPaise: 202000, method: 'upi', reference: null,
  recordedAt: now, actorSub: 'sub-1' };
const paid = { ...episode, pharmacyTotalPaise: 2000, totalPaise: 202000, paidPaise: 202000, outstandingPaise: 0,
  pharmacyDisposition: 'closed', checkoutStatus: 'paid', receiptIssued: true, revision: 6 };
const receipt = { id: 'RECEIPT#demo-1', label: 'SYNTHETIC DEMO RECEIPT', clinic: { slug: 'goodwell', displayName: 'Goodwell Clinic' },
  patient: { id: 'patient_1', fullName: 'Synthetic Patient' }, ...selection, issuedAt: now, issuedBySub: 'sub-1', currency: 'INR',
  charges: [charge], payments: [payment], totalPaise: 202000, paidPaise: 202000, outstandingPaise: 0 };
function mockJson(status, body, capture) {
  globalThis.fetch = async (url, init) => {
    capture?.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

test('queue, fee status, and arrival-only check-in use same-origin cookie API', async () => {
  const calls = [];
  mockJson(200, { items: [episode] }, calls);
  assert.equal((await listBillingEpisodes('goodwell', date)).length, 1);
  mockJson(200, { amountPaise: null, revision: 1 }, calls);
  assert.deepEqual(await readConsultationFee('goodwell', selection, 'csrf'), { amountPaise: null, revision: 1 });
  mockJson(200, { appointment: { id: appointmentId, status: 'checked_in' }, episode: { ...episode, revision: 1,
    consultationTotalPaise: 0, totalPaise: 0, outstandingPaise: 0, checkoutStatus: 'awaiting_fee' } }, calls);
  await checkInAppointment('goodwell', selection, operationId, 'csrf');
  assert.match(calls[0].url, /billing\/episodes\?date=2026-10-15$/);
  assert.match(calls[1].url, /billing\/consultation-fee\/read$/);
  assert.match(calls[2].url, /appointments\/check-in$/);
  assert.equal(calls[2].init.credentials, 'include');
  assert.equal(calls[2].init.headers['X-CSRF-Token'], 'csrf');
  assert.deepEqual(JSON.parse(calls[2].init.body), { ...selection, operationId });
});

test('bill detail accepts pharmacy charge IDs, but rejects a receipt from another clinic', async () => {
  mockJson(200, { episode: paid, charges: [charge], payments: [payment], receipt });
  const detail = await readBillingEpisode('goodwell', selection, 'csrf');
  assert.equal(detail.charges[0].id, charge.id);
  assert.equal(detail.receipt.id, receipt.id);
  mockJson(200, { episode: paid, charges: [charge], payments: [payment], receipt: { ...receipt, clinic: { slug: 'other', displayName: 'Other' } } });
  await assert.rejects(() => readBillingEpisode('goodwell', selection, 'csrf'), BillingApiError);
});

test('payment and final receipt requests send only selected episode identity, revision and operation ID', async () => {
  const calls = [];
  mockJson(200, { episode: { ...episode, paidPaise: 50000, outstandingPaise: 150000, revision: 3 }, payment: { ...payment, amountPaise: 50000 } }, calls);
  assert.equal((await recordPayment('goodwell', selection, 2, 50000, 'upi', '', operationId, 'csrf')).payment.amountPaise, 50000);
  assert.deepEqual(JSON.parse(calls[0].init.body), { ...selection, operationId, expectedRevision: 2, amountPaise: 50000, method: 'upi' });
  mockJson(200, { episode: paid, receipt }, calls);
  assert.equal((await issueReceipt('goodwell', selection, 5, operationId, 'csrf')).receipt.label, 'SYNTHETIC DEMO RECEIPT');
  assert.deepEqual(JSON.parse(calls[1].init.body), { ...selection, operationId, expectedRevision: 5 });
});

test('pharmacy read accepts untouched null unit and write omits doctor medicine identity', async () => {
  const calls = [];
  const item = { prescriptionIndex: 0, name: 'Synthetic medicine', strength: '5 mg', suppliedQuantity: 0, quantityUnit: null,
    status: 'not_supplied', supplies: [], remainingQuantity: null };
  mockJson(200, { ...selection, patient: { id: 'patient_1', fullName: 'Synthetic Patient' }, prescriptionRevision: 3,
    items: [item], episode: { ...episode, revision: 0 } }, calls);
  assert.equal((await readFulfillment('goodwell', selection, 'csrf')).items[0].quantityUnit, null);
  mockJson(200, { episode: { ...episode, pharmacyTotalPaise: 2000, totalPaise: 202000, outstandingPaise: 202000 } }, calls);
  await recordFulfillment('goodwell', selection, 0, 3, [{ prescriptionIndex: 0, quantity: 2, quantityUnit: 'tablet', unitPricePaise: 1000, status: 'partly_supplied' }], false, operationId, 'csrf');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.items[0].prescriptionIndex, 0);
  assert.equal(Object.hasOwn(body.items[0], 'name'), false);
  assert.equal(Object.hasOwn(body.items[0], 'strength'), false);
  assert.equal(body.closeForCheckout, false);
});

test('stale billing conflict is surfaced and HTML fallback fails closed', async () => {
  mockJson(409, { error: 'conflict' });
  await assert.rejects(() => recordPayment('goodwell', selection, 2, 1000, 'cash', '', operationId, 'csrf'),
    (error) => error instanceof BillingApiError && error.status === 409);
  globalThis.fetch = async () => new Response('<html>error</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(() => listBillingEpisodes('goodwell', date),
    (error) => error instanceof BillingApiError && error.status === null);
});

test('billing requests send only identity fields when given a full queue episode', async () => {
  const calls = [];
  mockJson(200, { episode, charges: [], payments: [], receipt: null }, calls);
  await readBillingEpisode('goodwell', episode, 'csrf');
  assert.deepEqual(JSON.parse(calls[0].init.body), selection);

  mockJson(200, { episode: { ...episode, consultationTotalPaise: 235000, totalPaise: 235000, outstandingPaise: 235000 } }, calls);
  await addConsultationCharge('goodwell', episode, 2, 235000, operationId, 'csrf');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    ...selection, expectedRevision: 2, amountPaise: 235000, operationId,
  });

  mockJson(200, { episode: { ...episode, paidPaise: 50000, outstandingPaise: 150000, revision: 3 },
    payment: { ...payment, amountPaise: 50000 } }, calls);
  await recordPayment('goodwell', episode, 2, 50000, 'upi', '', operationId, 'csrf');
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    ...selection, operationId, expectedRevision: 2, amountPaise: 50000, method: 'upi',
  });

  mockJson(200, { episode: paid, receipt }, calls);
  await issueReceipt('goodwell', episode, 5, operationId, 'csrf');
  assert.deepEqual(JSON.parse(calls[3].init.body), { ...selection, operationId, expectedRevision: 5 });

  const item = { prescriptionIndex: 0, name: 'Synthetic medicine', strength: '5 mg', suppliedQuantity: 0,
    quantityUnit: null, status: 'not_supplied', supplies: [], remainingQuantity: null };
  mockJson(200, { ...selection, patient: { id: 'patient_1', fullName: 'Synthetic Patient' },
    prescriptionRevision: 3, items: [item], episode: { ...episode, revision: 0 } }, calls);
  await readFulfillment('goodwell', episode, 'csrf');
  assert.deepEqual(JSON.parse(calls[4].init.body), selection);

  mockJson(200, { episode }, calls);
  await recordFulfillment('goodwell', episode, 2, 3, [{ prescriptionIndex: 0, quantity: 1,
    quantityUnit: 'tablet', unitPricePaise: 1000, status: 'supplied' }], true, operationId, 'csrf');
  assert.deepEqual(JSON.parse(calls[5].init.body), {
    ...selection, operationId, expectedRevision: 2, prescriptionRevision: 3,
    items: [{ prescriptionIndex: 0, quantity: 1, quantityUnit: 'tablet', unitPricePaise: 1000, status: 'supplied' }],
    closeForCheckout: true,
  });
});

test('manual fee responses must match the staff-entered amount', async () => {
  mockJson(200, { episode });
  await assert.rejects(() => addConsultationCharge('goodwell', selection, 1, 235000, operationId, 'csrf'), BillingApiError);
  mockJson(200, { amountPaise: -1, revision: 1 });
  await assert.rejects(() => readConsultationFee('goodwell', selection, 'csrf'), BillingApiError);
});
