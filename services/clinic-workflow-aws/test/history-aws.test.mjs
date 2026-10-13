import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the adapter's command contracts without installing SDK packages or making network calls.
const dynamoStub = `
  export class DynamoDBClient {}
  export class GetItemCommand { constructor(input) { this.input = input; } }
  export class QueryCommand { constructor(input) { this.input = input; } }
  export class TransactWriteItemsCommand { constructor(input) { this.input = input; } }
`;
const cognitoStub = `
  export class CognitoIdentityProviderClient {}
  export class AdminGetUserCommand { constructor(input) { this.input = input; } }
`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@aws-sdk/client-dynamodb') {
      return { url: `data:text/javascript,${encodeURIComponent(dynamoStub)}`, shortCircuit: true };
    }
    if (specifier === '@aws-sdk/client-cognito-identity-provider') {
      return { url: `data:text/javascript,${encodeURIComponent(cognitoStub)}`, shortCircuit: true };
    }
    if (specifier === './history.js' && context.parentURL?.endsWith('/src/aws.ts')) {
      return nextResolve('./history.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { DynamoWorkflowStore } = await import('../src/aws.ts');

test('finalization transaction atomically includes one metadata-only patient history pointer', async () => {
  let transaction;
  const client = { async send(command) { transaction = command.input; return {}; } };
  const store = new DynamoWorkflowStore(client, 'clinical-staging');
  const appointment = {
    id: 'appt_1', patientId: 'patient_1', doctorId: 'doctor_2',
    clinicDate: '2026-10-10', startUtc: '2026-10-10T04:00:00.000Z',
    startAt: '2026-10-10T09:30:00+05:30',
  };
  const encounter = {
    appointmentId: appointment.id, patientId: appointment.patientId, doctorId: appointment.doctorId,
    clinicDate: appointment.clinicDate, status: 'finalized', revision: 2,
    note: { chiefComplaint: 'Private synthetic text', history: '', exam: '', assessment: 'A', plan: 'P' },
    medications: [{ name: 'Private synthetic medicine' }],
    finalizedAt: '2026-10-10T04:30:00.000Z', finalizedBySub: 'doctor-sub-2',
    finalizedDoctorId: 'doctor_2', finalizedByDisplayName: 'Dr Demo Two',
    updatedAt: '2026-10-10T04:30:00.000Z',
  };
  assert.equal(await store.saveEncounter('goodwell', appointment, encounter, 1,
    'doctor-sub-2', 'encounter.finalized', 'doctor-sub-2'), true);
  assert.equal(transaction.TransactItems.length, 6);
  const pointer = transaction.TransactItems.at(-1).Put;
  assert.equal(pointer.Item.pk.S, 'CLINIC#goodwell#PATIENT#patient_1#HISTORY');
  assert.equal(pointer.Item.sk.S, 'VISIT#2026-10-10T04:00:00.000Z#APPOINTMENT#appt_1');
  assert.equal(pointer.Item.status.S, 'finalized');
  assert.equal(pointer.Item.finalizedByDisplayName.S, 'Dr Demo Two');
  assert.equal(pointer.ConditionExpression, 'attribute_not_exists(pk)');
  assert.equal(JSON.stringify(pointer).includes('Private synthetic text'), false);
  assert.equal(JSON.stringify(pointer).includes('Private synthetic medicine'), false);
  assert.equal(transaction.TransactItems.some((item) => item.Put?.Item?.action?.S === 'encounter.finalized'), true);
});

test('history adapter uses tenant/patient exact keys, strongly consistent bounded reverse query', async () => {
  const seen = [];
  const pointer = {
    pk: { S: 'CLINIC#goodwell#PATIENT#patient_1#HISTORY' },
    sk: { S: 'VISIT#2026-10-10T04:00:00.000Z#APPOINTMENT#appt_1' },
    clinicSlug: { S: 'goodwell' }, patientId: { S: 'patient_1' }, appointmentId: { S: 'appt_1' },
    clinicDate: { S: '2026-10-10' }, visitAt: { S: '2026-10-10T09:30:00+05:30' },
    visitUtc: { S: '2026-10-10T04:00:00.000Z' }, status: { S: 'finalized' },
    finalizedAt: { S: '2026-10-10T04:30:00.000Z' },
    finalizedDoctorId: { S: 'doctor_2' }, finalizedByDisplayName: { S: 'Dr Demo Two' },
  };
  const client = { async send(command) {
    seen.push(command.input);
    return 'ScanIndexForward' in command.input ? { Items: [pointer] } : { Item: pointer };
  } };
  const store = new DynamoWorkflowStore(client, 'clinical-staging');
  const rows = await store.listPatientHistory('goodwell', 'patient_1', 'VISIT#2026-10-10T04:30:00.000Z', 11);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doctor.displayName, 'Dr Demo Two');
  assert.equal(seen[0].ConsistentRead, true);
  assert.equal(seen[0].ScanIndexForward, false);
  assert.equal(seen[0].Limit, 11);
  assert.equal(seen[0].ExpressionAttributeValues[':pk'].S, 'CLINIC#goodwell#PATIENT#patient_1#HISTORY');
  assert.equal(seen[0].ExpressionAttributeValues[':before'].S, 'VISIT#2026-10-10T04:30:00.000Z');
  assert.equal(seen[0].KeyConditionExpression, 'pk = :pk AND sk < :before');
  const item = await store.getHistoryEntry('goodwell', 'patient_1', rows[0].historyId);
  assert.equal(item.historyId, rows[0].historyId);
  assert.equal(seen[1].ConsistentRead, true);
  assert.deepEqual(seen[1].Key, { pk: { S: 'CLINIC#goodwell#PATIENT#patient_1#HISTORY' },
    sk: { S: rows[0].historyId } });
});

test('prescription email claim and acceptance are metadata-only tenant transactions', async () => {
  const transactions = [];
  const client = { async send(command) { transactions.push(command.input); return {}; } };
  const store = new DynamoWorkflowStore(client, 'clinical-staging');
  const context = { clinicDate: '2026-10-10', patientId: 'patient_1', doctorId: 'doctor_1',
    storedEmail: 'patient@example.test' };
  assert.equal(await store.claimPrescriptionEmail('goodwell', 'appt_1', 3,
    'recipient-sha256', 'reception-sub', '2026-10-10T04:30:00.000Z', context), 'claimed');
  const claim = transactions[0];
  assert.equal(claim.TransactItems[0].ConditionCheck.Key.pk.S, 'CLINIC#goodwell#PATIENTS');
  assert.equal(claim.TransactItems[0].ConditionCheck.ExpressionAttributeValues[':email'].S, context.storedEmail);
  assert.equal(claim.TransactItems[1].ConditionCheck.Key.pk.S, 'CLINIC#goodwell#ENCOUNTERS#2026-10-10');
  assert.equal(claim.TransactItems[1].ConditionCheck.ExpressionAttributeValues[':revision'].N, '3');
  assert.equal(claim.TransactItems[2].Put.Item.pk.S, 'CLINIC#goodwell#PRESCRIPTION_EMAIL');
  assert.equal(claim.TransactItems[2].Put.Item.sk.S, 'APPOINTMENT#appt_1#REV#3');
  assert.equal(claim.TransactItems[2].Put.ConditionExpression, 'attribute_not_exists(pk)');
  assert.equal(claim.TransactItems[3].Put.Item.action.S, 'prescription.email.requested');
  await store.markPrescriptionEmail('goodwell', 'appt_1', 3,
    'accepted', '2026-10-10T04:30:01.000Z', 'ses-message-1');
  const accepted = transactions[1].TransactItems;
  assert.equal(accepted[0].Update.ConditionExpression, '#status = :pending');
  assert.equal(accepted[0].Update.Key.pk.S, 'CLINIC#goodwell#PRESCRIPTION_EMAIL');
  assert.equal(accepted[1].Put.Item.action.S, 'prescription.email.accepted');
  assert.equal(JSON.stringify([claim.TransactItems[2].Put.Item, claim.TransactItems[3].Put.Item,
    ...accepted.map((item) => item.Update ?? item.Put?.Item)]).includes(context.storedEmail), false);
});

test('existing email claim is read strongly and a changed recipient fails closed', async () => {
  const client = { async send(command) {
    if (command.input.TransactItems) {
      const error = new Error('conditional conflict'); error.name = 'TransactionCanceledException'; throw error;
    }
    assert.equal(command.input.ConsistentRead, true);
    return { Item: { recipientHash: { S: 'original-hash' }, status: { S: 'accepted' } } };
  } };
  const store = new DynamoWorkflowStore(client, 'clinical-staging');
  const context = { clinicDate: '2026-10-10', patientId: 'patient_1', doctorId: 'doctor_1',
    storedEmail: 'patient@example.test' };
  assert.equal(await store.claimPrescriptionEmail('goodwell', 'appt_1', 3,
    'original-hash', 'reception-sub', '2026-10-10T04:30:00.000Z', context), 'accepted');
  assert.equal(await store.claimPrescriptionEmail('goodwell', 'appt_1', 3,
    'changed-hash', 'reception-sub', '2026-10-10T04:30:00.000Z', context), 'recipient_changed');
});

test('changed stored email aborts the atomic claim before SES', async () => {
  const client = { async send(command) {
    assert.ok(command.input.TransactItems);
    const error = new Error('patient condition failed'); error.name = 'TransactionCanceledException';
    error.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' },
      { Code: 'None' }, { Code: 'None' }];
    throw error;
  } };
  const store = new DynamoWorkflowStore(client, 'clinical-staging');
  assert.equal(await store.claimPrescriptionEmail('goodwell', 'appt_1', 3,
    'recipient-sha256', 'reception-sub', '2026-10-10T04:30:00.000Z',
    { clinicDate: '2026-10-10', patientId: 'patient_1', doctorId: 'doctor_1',
      storedEmail: 'patient@example.test' }), 'stored_email_changed');
});
