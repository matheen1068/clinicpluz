import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { MODULES } from '../src/core.ts';

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
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@aws-sdk/client-dynamodb') {
    return { url: `data:text/javascript,${encodeURIComponent(dynamoStub)}`, shortCircuit: true };
  }
  if (specifier === '@aws-sdk/client-cognito-identity-provider') {
    return { url: `data:text/javascript,${encodeURIComponent(cognitoStub)}`, shortCircuit: true };
  }
  if (specifier === './core.js' && context.parentURL?.endsWith('/src/aws.ts')) {
    return nextResolve('./core.ts', context);
  }
  return nextResolve(specifier, context);
} });

const { DynamoControlRepository } = await import('../src/aws.ts');
const TABLE = 'synthetic-control-auth';
const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const OTHER_CUSTOMER = '22222222-2222-4222-8222-222222222222';
const AT = '2026-10-20T08:00:00.000Z';
const s = (value) => ({ S: value });
const n = (value) => ({ N: String(value) });
const b = (value) => ({ BOOL: value });
const customer = { id: CUSTOMER, displayName: 'Goodwell Group', createdAt: AT, version: 1 };
const branch = { slug: 'goodwell-north', customerId: CUSTOMER, branchName: 'North   Wing',
  displayName: 'Goodwell North', active: false, version: 1 };
const entitlements = { clinicSlug: branch.slug,
  modules: Object.fromEntries(MODULES.map((module) => [module, false])), version: 1 };
function audit(id, clinicSlug, action) {
  return { id, clinicSlug, actorSub: 'operator-sub', action, target: clinicSlug,
    at: AT, changes: { version: 1 } };
}
function key(item) { return `${item.pk.S}\0${item.sk.S}`; }
function conditionalFailure(index, length) {
  const error = new Error('conditional conflict');
  error.name = 'TransactionCanceledException';
  error.CancellationReasons = Array.from({ length }, (_, i) =>
    ({ Code: i === index ? 'ConditionalCheckFailed' : 'None' }));
  return error;
}
function branchItem(value, pk, sk) {
  return { pk: s(pk), sk: s(sk), slug: s(value.slug), customerId: s(value.customerId),
    branchName: s(value.branchName), displayName: s(value.displayName),
    active: b(value.active), version: n(value.version) };
}

test('customer and branch creation condition every uniqueness key in one transaction', async () => {
  const transactions = [];
  const committed = new Set();
  const repo = new DynamoControlRepository({ async send(command) {
    assert.equal(command.constructor.name, 'TransactWriteItemsCommand');
    const items = command.input.TransactItems;
    transactions.push(items);
    const conflict = items.findIndex((entry) => entry.Put && committed.has(key(entry.Put.Item)));
    if (conflict >= 0) throw conditionalFailure(conflict, items.length);
    for (const entry of items) if (entry.Put) committed.add(key(entry.Put.Item));
    return {};
  } }, TABLE);

  assert.equal(await repo.createCustomer(customer, audit('customer-1', `CUSTOMER#${CUSTOMER}`, 'customer.created')), true);
  const customerWrites = transactions[0];
  assert.equal(customerWrites.length, 3);
  assert.deepEqual(customerWrites.slice(0, 2).map(({ Put }) => key(Put.Item)),
    [`CUSTOMER#${CUSTOMER}\0META`, `CONTROL#CUSTOMERS\0NAME#goodwell group#${CUSTOMER}`]);
  assert.ok(customerWrites.every(({ Put }) => Put.TableName === TABLE &&
    Put.ConditionExpression === 'attribute_not_exists(pk)'));

  assert.equal(await repo.createBranch(branch, entitlements,
    audit('branch-1', branch.slug, 'branch.created')), true);
  const writes = transactions[1];
  assert.equal(writes.length, 6);
  assert.equal(writes[0].ConditionCheck.Key.pk.S, `CUSTOMER#${CUSTOMER}`);
  assert.equal(writes[0].ConditionCheck.Key.sk.S, 'META');
  assert.equal(writes[0].ConditionCheck.ExpressionAttributeValues[':id'].S, CUSTOMER);
  assert.deepEqual(writes.slice(1).map(({ Put }) => key(Put.Item)), [
    'CLINIC#goodwell-north\0META', 'CLINIC#goodwell-north\0ENTITLEMENTS',
    `CUSTOMER#${CUSTOMER}\0BRANCH#north wing`, 'CONTROL#BRANCHES\0SLUG#goodwell-north',
    'AUDIT#goodwell-north\0' + `${AT}#branch-1`,
  ]);
  assert.ok(writes.slice(1).every(({ Put }) => Put.TableName === TABLE &&
    Put.ConditionExpression === 'attribute_not_exists(pk)'));
  assert.equal(writes[1].Put.Item.active.BOOL, false);
  assert.equal(writes[2].Put.Item.version.N, '1');
  assert.ok(MODULES.every((module) => writes[2].Put.Item.modules.M[module].BOOL === false));

  const before = new Set(committed);
  assert.equal(await repo.createBranch({ ...branch, slug: 'goodwell-south',
    branchName: ' NORTH wing ' }, { ...entitlements, clinicSlug: 'goodwell-south' },
  audit('branch-2', 'goodwell-south', 'branch.created')), false);
  assert.deepEqual(committed, before);
  assert.equal(transactions[2][3].Put.Item.sk.S, 'BRANCH#north wing');
  assert.equal(await repo.createBranch({ ...branch, customerId: OTHER_CUSTOMER,
    branchName: 'South Wing' }, entitlements,
  audit('branch-3', branch.slug, 'branch.created')), false);
  assert.deepEqual(committed, before);
  assert.equal(transactions[3][1].Put.Item.pk.S, 'CLINIC#goodwell-north');
});

test('directory pages use only bounded strongly consistent partition queries with scoped cursors', async () => {
  const seen = [];
  const customerRows = Array.from({ length: 21 }, (_, index) => {
    const displayName = `Good ${String(index).padStart(2, '0')}`;
    const id = `customer-${index}`;
    return { pk: s('CONTROL#CUSTOMERS'), sk: s(`NAME#${displayName.toLowerCase()}#${id}`),
      id: s(id), displayName: s(displayName), createdAt: s(AT), version: n(1) };
  });
  const repo = new DynamoControlRepository({ async send(command) {
    seen.push(command);
    assert.equal(command.constructor.name, 'QueryCommand');
    const pk = command.input.ExpressionAttributeValues[':pk'].S;
    if (pk === 'CONTROL#CUSTOMERS') return { Items: customerRows };
    if (pk === `CUSTOMER#${CUSTOMER}`) return { Items: [branchItem(branch,
      `CUSTOMER#${CUSTOMER}`, 'BRANCH#north wing')] };
    if (pk === 'CONTROL#BRANCHES') return { Items: [branchItem(branch,
      'CONTROL#BRANCHES', 'SLUG#goodwell-north')] };
    throw new Error('Unexpected partition');
  } }, TABLE);

  const customers = await repo.listCustomers('good', null);
  assert.equal(customers.items.length, 20);
  assert.equal(customers.nextKey, 'NAME#good 19#customer-19');
  const own = await repo.listCustomerBranches(CUSTOMER, null);
  assert.deepEqual(own.items, [branch]);
  assert.equal(own.nextKey, null);
  const global = await repo.listBranches('good', 'SLUG#goodwell');
  assert.deepEqual(global.items, [branch]);
  assert.deepEqual(seen.map(({ input }) => input.ExpressionAttributeValues[':pk'].S),
    ['CONTROL#CUSTOMERS', `CUSTOMER#${CUSTOMER}`, 'CONTROL#BRANCHES']);
  assert.deepEqual(seen.map(({ input }) => input.ExpressionAttributeValues[':prefix'].S),
    ['NAME#good', 'BRANCH#', 'SLUG#good']);
  assert.ok(seen.every(({ input }) => input.TableName === TABLE && input.ConsistentRead === true &&
    input.KeyConditionExpression === 'pk = :pk AND begins_with(sk, :prefix)' && input.Limit === 21));
  assert.deepEqual(seen[2].input.ExclusiveStartKey,
    { pk: s('CONTROL#BRANCHES'), sk: s('SLUG#goodwell') });
  await assert.rejects(() => repo.listCustomerBranches(CUSTOMER, 'SLUG#other'), /Invalid directory cursor/);
  assert.equal(seen.length, 3);
});

test('customer branch reads reject a foreign or corrupt directory row', async () => {
  const seen = [];
  let returned = branchItem(branch, `CUSTOMER#${CUSTOMER}`, 'BRANCH#north wing');
  const repo = new DynamoControlRepository({ async send(command) {
    seen.push(command);
    if (command.constructor.name === 'GetItemCommand') return { Item: returned };
    if (command.constructor.name === 'QueryCommand') return { Items: [returned] };
    throw new Error('Unexpected command');
  } }, TABLE);
  assert.deepEqual(await repo.getCustomerBranch(CUSTOMER, 'north wing'), branch);
  assert.equal(seen[0].input.ConsistentRead, true);
  assert.deepEqual(seen[0].input.Key,
    { pk: s(`CUSTOMER#${CUSTOMER}`), sk: s('BRANCH#north wing') });
  returned = branchItem({ ...branch, customerId: OTHER_CUSTOMER },
    `CUSTOMER#${CUSTOMER}`, 'BRANCH#north wing');
  await assert.rejects(() => repo.getCustomerBranch(CUSTOMER, 'north wing'), /Branch key mismatch/);
  await assert.rejects(() => repo.listCustomerBranches(CUSTOMER, null), /Invalid branch directory/);
});

test('branch state transaction updates canonical and both directory statuses at the same revision', async () => {
  let transaction;
  const repo = new DynamoControlRepository({ async send(command) {
    transaction = command.input.TransactItems;
    return {};
  } }, TABLE);
  const active = { ...branch, active: true, version: 2 };
  assert.equal(await repo.setClinicState(active, 1, 'alice',
    audit('state-1', branch.slug, 'clinic.state_changed')), true);
  assert.equal(transaction.length, 5);
  assert.equal(transaction[0].ConditionCheck.Key.pk.S, 'CLINIC#goodwell-north');
  assert.equal(transaction[0].ConditionCheck.Key.sk.S, 'STAFF#alice');
  assert.deepEqual(transaction.slice(1, 4).map(({ Update }) => key(Update.Key)), [
    'CLINIC#goodwell-north\0META', `CUSTOMER#${CUSTOMER}\0BRANCH#north wing`,
    'CONTROL#BRANCHES\0SLUG#goodwell-north',
  ]);
  assert.ok(transaction.slice(1, 4).every(({ Update }) =>
    Update.UpdateExpression === 'SET #active = :active, #version = :next' &&
    Update.ExpressionAttributeValues[':active'].BOOL === true &&
    Update.ExpressionAttributeValues[':next'].N === '2' &&
    Update.ExpressionAttributeValues[':expected'].N === '1'));
  assert.ok(transaction.slice(2, 4).every(({ Update }) =>
    Update.ExpressionAttributeValues[':customer'].S === CUSTOMER &&
    Update.ExpressionAttributeValues[':slug'].S === branch.slug &&
    Update.ConditionExpression.includes('#version = :expected')));
  assert.equal(transaction[4].Put.Item.pk.S, 'AUDIT#goodwell-north');
  assert.equal(transaction[4].Put.ConditionExpression, 'attribute_not_exists(pk)');
});

test('legacy adoption preserves active clinic and reviewed modules while adding ownership atomically', async () => {
  const legacyMeta = { pk: s('CLINIC#goodwell'), sk: s('META'),
    slug: s('goodwell'), displayName: s('Goodwell Clinic'), active: b(true) };
  const oldMap = { patient_intake: b(true), appointments: b(true), consultations: b(true), billing: b(true) };
  const legacyEntitlements = { pk: s('CLINIC#goodwell'), sk: s('ENTITLEMENTS'),
    clinicSlug: s('goodwell'), modules: { M: oldMap } };
  let transaction;
  const repo = new DynamoControlRepository({ async send(command) {
    if (command.constructor.name === 'GetItemCommand') {
      return { Item: command.input.Key.sk.S === 'META' ? legacyMeta : legacyEntitlements };
    }
    assert.equal(command.constructor.name, 'TransactWriteItemsCommand');
    transaction = command.input.TransactItems;
    return {};
  } }, TABLE);
  assert.equal((await repo.getClinic('goodwell')).version, 1);
  const modules = await repo.getEntitlements('goodwell');
  assert.equal(modules.version, 1);
  assert.equal(modules.modules.billing, true);
  assert.equal(modules.modules.prescriptions, false);
  const adopted = { slug: 'goodwell', customerId: CUSTOMER, branchName: 'Main',
    displayName: 'Goodwell Clinic', active: true, version: 1 };
  assert.equal(await repo.adoptLegacyBranch(adopted, modules,
    audit('adopt-1', 'goodwell', 'branch.legacy_adopted')), true);
  assert.equal(transaction.length, 6);
  assert.equal(transaction[0].ConditionCheck.Key.pk.S, `CUSTOMER#${CUSTOMER}`);
  assert.equal(transaction[1].Update.Key.pk.S, 'CLINIC#goodwell');
  assert.equal(transaction[1].Update.ExpressionAttributeValues[':active'].BOOL, true);
  assert.match(transaction[1].Update.ConditionExpression, /attribute_not_exists\(#version\)/);
  assert.match(transaction[2].Update.ConditionExpression, /#modules = :oldModules/);
  assert.deepEqual(transaction[2].Update.ExpressionAttributeValues[':oldModules'], { M: oldMap });
  assert.equal(transaction[2].Update.ExpressionAttributeValues[':modules'].M.billing.BOOL, true);
  assert.equal(transaction[2].Update.ExpressionAttributeValues[':modules'].M.prescriptions.BOOL, false);
  assert.deepEqual(transaction.slice(3, 5).map(({ Put }) => key(Put.Item)), [
    `CUSTOMER#${CUSTOMER}\0BRANCH#main`, 'CONTROL#BRANCHES\0SLUG#goodwell',
  ]);
  assert.equal(transaction[3].Put.Item.active.BOOL, true);
  assert.equal(transaction[5].Put.Item.action.S, 'branch.legacy_adopted');
  assert.equal(transaction.some((entry) => entry.Update?.Key.sk.S?.startsWith('STAFF#')), false);
  assert.equal(await repo.adoptLegacyBranch(adopted, { ...modules,
    modules: { ...modules.modules, billing: false } }, audit('adopt-2', 'goodwell', 'branch.legacy_adopted')), false);
});

test('versionless legacy staff can be updated once, then require an exact version', async () => {
  const legacyStaff = { pk: s('CLINIC#goodwell'), sk: s('STAFF#reception'),
    clinicSlug: s('goodwell'), username: s('reception'), cognitoUsername: s('reception'),
    sub: s('staff-sub'), displayName: s('Reception'), role: s('receptionist'), active: b(true) };
  const transactions = [];
  const repo = new DynamoControlRepository({ async send(command) {
    if (command.constructor.name === 'GetItemCommand') return { Item: legacyStaff };
    assert.equal(command.constructor.name, 'TransactWriteItemsCommand');
    transactions.push(command.input.TransactItems);
    return {};
  } }, TABLE);

  const read = await repo.getStaff('goodwell', 'reception');
  assert.equal(read.version, 1);
  assert.equal(await repo.replaceStaff({ ...read, active: false, version: 2 }, 1, false,
    audit('staff-1', 'goodwell', 'staff.updated')), true);
  const first = transactions[0][0].Update;
  assert.match(first.ConditionExpression, /attribute_not_exists\(#version\)/);
  assert.equal(first.ExpressionAttributeValues[':expected'].N, '1');
  assert.equal(first.ExpressionAttributeValues[':next'].N, '2');
  assert.equal(transactions[0][1].Put.Item.action.S, 'staff.updated');

  assert.equal(await repo.replaceStaff({ ...read, active: true, version: 3 }, 2, false,
    audit('staff-2', 'goodwell', 'staff.updated')), true);
  const second = transactions[1][0].Update;
  assert.equal(second.ConditionExpression.includes('attribute_not_exists(#version)'), false);
  assert.equal(second.ExpressionAttributeValues[':expected'].N, '2');
  assert.equal(second.ExpressionAttributeValues[':next'].N, '3');
});

test('diagnostics query only a bounded branch audit window and project safe fields', async () => {
  const from = '2026-10-13T08:00:00.000Z';
  const id = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  let rows = Array.from({ length: 21 }, (_, index) => ({
    pk: s('AUDIT#goodwell'), sk: s(`${AT}#${id(index)}`), at: s(AT),
    action: s(index === 0 ? 'private action payload' : 'staff.updated'),
    actorSub: s('private-operator'), target: s('private-staff'),
  }));
  const seen = [];
  const repo = new DynamoControlRepository({ async send(command) {
    assert.equal(command.constructor.name, 'QueryCommand');
    seen.push(command.input);
    return { Items: rows };
  } }, TABLE);
  const page = await repo.listRecentChanges('goodwell', from, AT);
  assert.equal(page.items.length, 20);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.items[0], { id: id(0), at: AT, action: 'other_change' });
  assert.equal(JSON.stringify(page).includes('private-'), false);
  assert.equal(seen[0].TableName, TABLE);
  assert.equal(seen[0].ConsistentRead, true);
  assert.equal(seen[0].ScanIndexForward, false);
  assert.equal(seen[0].Limit, 21);
  assert.equal(seen[0].KeyConditionExpression, 'pk = :pk AND sk BETWEEN :from AND :to');
  assert.deepEqual(seen[0].ExpressionAttributeValues,
    { ':pk': s('AUDIT#goodwell'), ':from': s(from), ':to': s(`${AT}~`) });
  assert.equal(seen[0].ProjectionExpression, 'pk, sk, #at, #action');
  assert.deepEqual(seen[0].ExpressionAttributeNames, { '#at': 'at', '#action': 'action' });

  rows = [{ ...rows[0], pk: s('AUDIT#blesswell') }];
  await assert.rejects(() => repo.listRecentChanges('goodwell', from, AT), /Invalid audit record/);
  rows = [{ ...rows[0], pk: s('AUDIT#goodwell'), at: s('2026-09-01T08:00:00.000Z') }];
  await assert.rejects(() => repo.listRecentChanges('goodwell', from, AT), /Invalid audit record/);
  rows = [];
  assert.deepEqual(await repo.listRecentChanges('goodwell', from, AT), { items: [], hasMore: false });
});
