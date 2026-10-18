import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

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
const key = (pk, sk) => `${pk}\u0000${sk}`;

function memoryClient() {
  const rows = new Map();
  const transactions = [];
  return {
    rows, transactions,
    async send(command) {
      const input = command.input;
      if (input.TransactItems) {
        transactions.push(input.TransactItems);
        for (const entry of input.TransactItems) {
          if (entry.ConditionCheck) {
            const { pk, sk } = entry.ConditionCheck.Key;
            const existing = rows.get(key(pk.S, sk.S));
            if (!existing || existing.phone?.S !== entry.ConditionCheck.ExpressionAttributeValues[':phone'].S) {
              throw new Error('Condition check failed');
            }
          }
          if (entry.Put && rows.has(key(entry.Put.Item.pk.S, entry.Put.Item.sk.S))) {
            throw new Error('Conditional put failed');
          }
        }
        for (const entry of input.TransactItems) {
          if (entry.Put) rows.set(key(entry.Put.Item.pk.S, entry.Put.Item.sk.S), entry.Put.Item);
        }
        return {};
      }
      if (input.Key) return { Item: rows.get(key(input.Key.pk.S, input.Key.sk.S)) };
      if (input.KeyConditionExpression) {
        const pk = input.ExpressionAttributeValues[':pk'].S;
        const prefix = input.ExpressionAttributeValues[':prefix'].S;
        return { Items: [...rows.values()].filter((row) => row.pk.S === pk && row.sk.S.startsWith(prefix))
          .sort((a, b) => a.sk.S.localeCompare(b.sk.S)).slice(0, input.Limit) };
      }
      throw new Error('Unexpected command');
    },
  };
}

test('Dynamo stores same-phone patients under distinct canonical and search keys, with atomic contact validation', async () => {
  const client = memoryClient();
  const store = new DynamoWorkflowStore(client, 'clinical-staging');
  const base = { phone: '+91 98765 43210', ageYears: 38, sex: 'female',
    registeredAt: '2026-10-19T09:00:00.000Z' };
  const parent = { ...base, id: 'parent-1', fullName: 'Demo Parent', email: 'parent@example.test', contactPatientId: null };
  const child = { ...base, id: 'child-2', fullName: 'Demo Child', ageYears: 8,
    email: null, contactPatientId: parent.id };
  await store.createPatient('goodwell', parent, 'demo parent', '919876543210', 'staff-1', null);
  await store.createPatient('goodwell', child, 'demo child', '919876543210', 'staff-1', parent);
  assert.equal(client.transactions[0].length, 4);
  assert.equal(client.transactions[1].length, 5);
  assert.equal(client.transactions[1][0].ConditionCheck.Key.pk.S, 'CLINIC#goodwell#PATIENTS');
  assert.equal(client.transactions[1][0].ConditionCheck.Key.sk.S, 'PATIENT#parent-1');
  assert.equal(client.transactions[1][0].ConditionCheck.ExpressionAttributeValues[':phone'].S, parent.phone);
  assert.ok(client.transactions[1].every((entry) => !entry.Put ||
    entry.Put.ConditionExpression === 'attribute_not_exists(pk)'));
  const found = await store.searchPatients('goodwell', 'phone', '9198765');
  assert.deepEqual(found.map((row) => row.id), ['child-2', 'parent-1']);
  assert.equal(found.find((row) => row.id === child.id).contactPatientId, parent.id);
  assert.equal((await store.getPatient('goodwell', child.id)).email, null);
  assert.equal(await store.getPatient('blesswell', child.id), null);
  assert.equal(client.rows.has(key('CLINIC#goodwell#PATIENTS', 'PATIENT#parent-1')), true);
  assert.equal(client.rows.has(key('CLINIC#goodwell#PATIENTS', 'PATIENT#child-2')), true);
  await assert.rejects(store.createPatient('goodwell', parent, 'demo parent', '919876543210', 'staff-1', null));
  assert.equal((await store.getPatient('goodwell', parent.id)).email, parent.email);
  client.rows.get(key('CLINIC#goodwell#PATIENTS', 'PATIENT#parent-1')).phone = { S: '+91 98765 43211' };
  await assert.rejects(store.createPatient('goodwell', { ...child, id: 'child-4' },
    'demo child', '919876543210', 'staff-1', parent));
  assert.equal(await store.getPatient('goodwell', 'child-4'), null);
  const other = { ...child, id: 'child-3' };
  await assert.rejects(store.createPatient('blesswell', other, 'demo child', '919876543210', 'staff-1', parent));
  assert.equal(await store.getPatient('blesswell', other.id), null);
});

test('older patient rows without contactPatientId read as unlinked', async () => {
  const client = memoryClient();
  client.rows.set(key('CLINIC#goodwell#PATIENTS', 'PATIENT#legacy-1'), {
    pk: { S: 'CLINIC#goodwell#PATIENTS' }, sk: { S: 'PATIENT#legacy-1' },
    id: { S: 'legacy-1' }, fullName: { S: 'Demo Legacy' }, phone: { S: '+91 98765 43210' },
    ageYears: { N: '38' }, sex: { S: 'female' }, email: { NULL: true },
    registeredAt: { S: '2026-10-01T09:00:00.000Z' },
  });
  const store = new DynamoWorkflowStore(client, 'clinical-staging');
  assert.equal((await store.getPatient('goodwell', 'legacy-1')).contactPatientId, null);
});
