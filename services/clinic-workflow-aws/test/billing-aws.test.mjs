import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const dynamoStub = `
  export class DynamoDBClient {}
  export class GetItemCommand { constructor(input) { this.input = input; } }
  export class QueryCommand { constructor(input) { this.input = input; } }
  export class TransactWriteItemsCommand { constructor(input) { this.input = input; } }
`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@aws-sdk/client-dynamodb') {
    return { url: `data:text/javascript,${encodeURIComponent(dynamoStub)}`, shortCircuit: true };
  }
  if (specifier === './billing.js' && context.parentURL?.endsWith('/src/billing-aws.ts')) {
    return nextResolve('./billing.ts', context);
  }
  return nextResolve(specifier, context);
} });

const { DynamoBillingStore } = await import('../src/billing-aws.ts');
const at = '2026-10-15T04:30:00.000Z';
const appointment = { id: 'appt_1', patientId: 'patient_1', patientName: 'Synthetic Patient',
  doctorId: 'doctor_1', doctorName: 'Dr Demo', clinicDate: '2026-10-15',
  startUtc: '2026-10-15T04:00:00.000Z', status: 'booked' };
const episode = { appointmentId: appointment.id, clinicDate: appointment.clinicDate,
  patientId: appointment.patientId, patientName: appointment.patientName,
  currency: 'INR', revision: 1, consultationTotalPaise: 200_000,
  pharmacyTotalPaise: 0, paidPaise: 0, pharmacyClosed: false,
  pharmacyLineCount: 0, paymentCount: 0, receiptIssued: false,
  createdAt: at, updatedAt: at };
const operation = { id: '11111111-1111-4111-8111-111111111111',
  kind: 'check_in', fingerprint: 'x'.repeat(64), at };
const charge = { id: 'CONSULTATION', kind: 'consultation', description: 'Clinic consultation',
  quantity: 1, quantityUnit: 'visit', unitPricePaise: 200_000, amountPaise: 200_000,
  source: 'staff_manual', createdAt: at, actorSub: 'reception-sub' };

test('check-in transaction atomically changes arrival without adding a fee', async () => {
  let transaction;
  const store = new DynamoBillingStore({ async send(command) { transaction = command.input; return {}; } }, 'clinical-staging');
  assert.equal(await store.commit('goodwell', { appointment, actorSub: 'reception-sub',
    previousRevision: 0, nextEpisode: { ...episode, consultationTotalPaise: 0 }, operation,
    checkInBooked: true }), true);
  const items = transaction.TransactItems;
  assert.equal(items.length, 5);
  const arrival = items[0].Update;
  assert.equal(arrival.Key.pk.S, 'CLINIC#goodwell#APPOINTMENTS#2026-10-15');
  assert.equal(arrival.ExpressionAttributeValues[':status'].S, 'booked');
  assert.equal(arrival.ExpressionAttributeValues[':checkedIn'].S, 'checked_in');
  assert.match(arrival.ConditionExpression, /patientId = :patient AND doctorId = :doctor/);
  assert.equal(items[1].Put.Item.pk.S, 'CLINIC#goodwell#BILL#appt_1');
  assert.equal(items[1].Put.Item.revision.N, '1');
  assert.equal(items[1].Put.ConditionExpression, 'attribute_not_exists(pk)');
  assert.equal(items[2].Put.Item.pk.S, 'CLINIC#goodwell#BILLING#2026-10-15');
  assert.equal(items[3].Put.Item.sk.S, `OP#${operation.id}`);
  assert.equal(items[4].Put.Item.action.S, 'billing.check_in');
  assert.equal(JSON.stringify(items[4]).includes('Synthetic Patient'), false);
});

test('doctor fee transaction rechecks active roster binding and creates only one charge', async () => {
  let transaction;
  const store = new DynamoBillingStore({ async send(command) { transaction = command.input; return {}; } }, 'clinical-staging');
  assert.equal(await store.commit('goodwell', { appointment: { ...appointment, status: 'checked_in' },
    actorSub: 'doctor-sub', previousRevision: 1, nextEpisode: { ...episode, revision: 2 },
    operation: { ...operation, kind: 'consultation_charge' }, charges: [charge],
    doctorStaffSub: 'doctor-sub', requireCheckedIn: true }), true);
  const items = transaction.TransactItems;
  assert.equal(items[1].ConditionCheck.Key.pk.S, 'CLINIC#goodwell#DOCTORS');
  assert.equal(items[1].ConditionCheck.Key.sk.S, 'DOCTOR#doctor_1');
  assert.equal(items[1].ConditionCheck.ExpressionAttributeValues[':sub'].S, 'doctor-sub');
  assert.equal(items[4].Put.Item.sk.S, 'CHARGE#CONSULTATION');
  assert.equal(items[4].Put.ConditionExpression, 'attribute_not_exists(pk)');
});

test('receipt transaction compares bill revision and canonical finalized encounter before immutable snapshot', async () => {
  let transaction;
  const store = new DynamoBillingStore({ async send(command) { transaction = command.input; return {}; } }, 'clinical-staging');
  const receipt = { id: 'demo-receipt', issuedBySub: 'reception-sub' };
  const nextEpisode = { ...episode, revision: 4, receiptIssued: true };
  assert.equal(await store.commit('goodwell', { appointment: { ...appointment, status: 'checked_in' },
    actorSub: 'reception-sub', previousRevision: 3, nextEpisode,
    operation: { ...operation, kind: 'receipt' }, encounterRevision: 2, receipt }), true);
  const items = transaction.TransactItems;
  assert.equal(items[0].ConditionCheck.ExpressionAttributeValues[':status'].S, 'checked_in');
  assert.equal(items[1].ConditionCheck.Key.pk.S, 'CLINIC#goodwell#ENCOUNTERS#2026-10-15');
  assert.equal(items[1].ConditionCheck.ExpressionAttributeValues[':finalized'].S, 'finalized');
  assert.equal(items[1].ConditionCheck.ExpressionAttributeValues[':revision'].N, '2');
  assert.equal(items[2].Put.ConditionExpression, '#revision = :expected');
  assert.equal(items[2].Put.ExpressionAttributeValues[':expected'].N, '3');
  assert.equal(items[4].Put.Item.sk.S, 'RECEIPT');
  assert.equal(items[4].Put.ConditionExpression, 'attribute_not_exists(pk)');
});

test('billing reads are strongly consistent, tenant-keyed and bounded without scans', async () => {
  const seen = [];
  const store = new DynamoBillingStore({ async send(command) {
    seen.push(command.input);
    if (command.input.Key?.sk?.S === 'BILLING') return { Item: {
      currency: { S: 'INR' }, consultationFeePaise: { N: '200000' }, version: { N: '1' } } };
    return { Items: [] };
  } }, 'clinical-staging');
  assert.deepEqual(await store.getConfig('goodwell'), { currency: 'INR', consultationFeePaise: 200_000, version: 1 });
  await store.load('goodwell', 'appt_1');
  await store.listEpisodes('goodwell', '2026-10-15');
  assert.equal(seen[0].ConsistentRead, true);
  assert.equal(seen[0].Key.pk.S, 'CLINIC#goodwell#CONFIG');
  assert.equal(seen[1].ConsistentRead, true);
  assert.equal(seen[1].ExpressionAttributeValues[':pk'].S, 'CLINIC#goodwell#BILL#appt_1');
  assert.equal(seen[1].KeyConditionExpression, 'pk = :pk');
  assert.equal(seen[1].Limit, 251);
  assert.equal(seen[2].ExpressionAttributeValues[':pk'].S, 'CLINIC#goodwell#BILLING#2026-10-15');
  assert.equal(seen[2].Limit, 201);
});

test('durable operation lookup is tenant-bound and a conditional race never reports a second write', async () => {
  const seen = [];
  const store = new DynamoBillingStore({ async send(command) {
    seen.push(command.input);
    if (command.input.TransactItems) {
      const error = new Error('conditional race');
      error.name = 'TransactionCanceledException';
      error.CancellationReasons = [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }];
      throw error;
    }
    return { Item: { document: { S: JSON.stringify(operation) } } };
  } }, 'clinical-staging');
  assert.deepEqual(await store.getOperation('goodwell', appointment.id, operation.id), operation);
  assert.equal(seen[0].ConsistentRead, true);
  assert.equal(seen[0].Key.pk.S, 'CLINIC#goodwell#BILL#appt_1');
  assert.equal(seen[0].Key.sk.S, `OP#${operation.id}`);
  assert.equal(await store.commit('goodwell', { appointment, actorSub: 'reception-sub',
    previousRevision: 0, nextEpisode: episode, operation, checkInBooked: true }), false);
  assert.equal(seen[1].TransactItems[1].Put.ConditionExpression, 'attribute_not_exists(pk)');
});

test('SAM registers every billing route on the existing workflow API', () => {
  const template = readFileSync(new URL('../template.yaml', import.meta.url), 'utf8');
  for (const suffix of [
    'appointments/check-in', 'dashboard', 'billing/config', 'billing/episodes', 'billing/read',
    'billing/consultation-fee/read',
    'billing/consultation-charge', 'billing/fulfillment/read', 'billing/fulfillment',
    'billing/payments', 'billing/receipt',
  ]) assert.ok(template.includes(`/api/workflow/clinics/{slug}/${suffix}`), suffix);
});
