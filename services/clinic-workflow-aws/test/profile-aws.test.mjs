import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const s3Stub = `
  export class S3Client {}
  export class PutObjectCommand { constructor(input) { this.input = input; } }
  export class GetObjectCommand { constructor(input) { this.input = input; } }
  export class DeleteObjectCommand { constructor(input) { this.input = input; } }
`;
const presignStub = `
  export async function createPresignedPost(_client, options) {
    return { url: 'https://private-upload.s3.ap-south-1.amazonaws.com/',
      fields: { key: options.Key, ...options.Fields, policy: 'test' } };
  }
`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@aws-sdk/client-dynamodb') {
    return { url: `data:text/javascript,${encodeURIComponent(dynamoStub)}`, shortCircuit: true };
  }
  if (specifier === '@aws-sdk/client-cognito-identity-provider') {
    return { url: `data:text/javascript,${encodeURIComponent(cognitoStub)}`, shortCircuit: true };
  }
  if (specifier === '@aws-sdk/client-s3') {
    return { url: `data:text/javascript,${encodeURIComponent(s3Stub)}`, shortCircuit: true };
  }
  if (specifier === '@aws-sdk/s3-presigned-post') {
    return { url: `data:text/javascript,${encodeURIComponent(presignStub)}`, shortCircuit: true };
  }
  if (specifier === './history.js' && context.parentURL?.endsWith('/src/aws.ts')) {
    return nextResolve('./history.ts', context);
  }
  return nextResolve(specifier, context);
} });

const { DynamoAuthStore, DynamoWorkflowStore } = await import('../src/aws.ts');
const { S3ClinicLogoStore } = await import('../src/profile-aws.ts');
const S = (value) => ({ S: value });
const N = (value) => ({ N: String(value) });
const at = '2026-11-02T10:00:00.000Z';

test('profile access reads branch-specific control setting strongly consistently and rejects invalid roles', async () => {
  let item = { pk: S('CLINIC#goodwell'), sk: S('PROFILE_ACCESS'),
    editRoles: { L: [S('doctor'), S('receptionist')] }, version: N(2) };
  const calls = [];
  const auth = new DynamoAuthStore({ async send(command) {
    calls.push(command.input);
    return { Item: item };
  } }, 'auth-table');
  assert.deepEqual(await auth.getProfileAccess('goodwell'),
    { editRoles: ['doctor', 'receptionist'], version: 2 });
  assert.deepEqual(calls[0].Key, { pk: S('CLINIC#goodwell'), sk: S('PROFILE_ACCESS') });
  assert.equal(calls[0].ConsistentRead, true);
  item = { ...item, editRoles: { L: [S('pharmacist'), S('pharmacist')] } };
  await assert.rejects(() => auth.getProfileAccess('goodwell'), /Invalid profile access roles/);
  item = { ...item, editRoles: { L: [S('unknown')] } };
  await assert.rejects(() => auth.getProfileAccess('goodwell'), /Invalid profile access roles/);
  item = undefined;
  assert.equal(await auth.getProfileAccess('goodwell'), null);
});

test('profile writes use tenant key, revision condition and metadata-only audit in one transaction', async () => {
  let transaction;
  let conflict = false;
  const store = new DynamoWorkflowStore({ async send(command) {
    transaction = command.input.TransactItems;
    if (conflict) {
      const error = new Error('stale');
      error.name = 'TransactionCanceledException';
      error.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
      throw error;
    }
    return {};
  } }, 'clinical-table');
  const profile = { slug: 'goodwell', displayName: 'Goodwell Demo', address: '123 Demo Road',
    phone: '+91 98765 43210', email: 'hello@example.test', revision: 1, logo: null };
  assert.equal(await store.saveClinicProfile('goodwell', profile, 0,
    'doctor-sub', at, 'profile.updated'), true);
  assert.equal(transaction.length, 2);
  assert.deepEqual(transaction[0].Put.Item.pk, S('CLINIC#goodwell#CONFIG'));
  assert.deepEqual(transaction[0].Put.Item.sk, S('PROFILE'));
  assert.equal(transaction[0].Put.ConditionExpression, 'attribute_not_exists(pk)');
  assert.equal(transaction[1].Put.Item.pk.S, 'CLINIC#goodwell#AUDIT');
  assert.equal(transaction[1].Put.Item.action.S, 'profile.updated');
  assert.equal(transaction[1].Put.Item.revision.N, '1');
  assert.equal(JSON.stringify(transaction[1]).includes('123 Demo Road'), false);
  assert.equal(JSON.stringify(transaction[1]).includes('hello@example.test'), false);

  const next = { ...profile, revision: 2, displayName: 'Changed' };
  assert.equal(await store.saveClinicProfile('goodwell', next, 1,
    'doctor-sub', at, 'profile.updated'), true);
  assert.equal(transaction[0].Put.ConditionExpression,
    '#revision = :expected AND #clinicSlug = :slug');
  assert.equal(transaction[0].Put.ExpressionAttributeValues[':expected'].N, '1');
  conflict = true;
  assert.equal(await store.saveClinicProfile('goodwell', next, 1,
    'doctor-sub', at, 'profile.updated'), false);
  await assert.rejects(() => store.saveClinicProfile('blesswell', next, 1,
    'doctor-sub', at, 'profile.updated'), /Invalid profile revision/);
});

test('profile reads use the exact clinic configuration key and reject foreign records', async () => {
  let item = { pk: S('CLINIC#goodwell#CONFIG'), sk: S('PROFILE'), clinicSlug: S('goodwell'),
    displayName: S('Goodwell Demo'), address: S('123 Demo Road'),
    phone: { NULL: true }, email: S('hello@example.test'), revision: N(3),
    logoKey: { NULL: true }, logoContentType: { NULL: true }, logoSha256: { NULL: true } };
  let input;
  const store = new DynamoWorkflowStore({ async send(command) {
    input = command.input;
    return { Item: item };
  } }, 'clinical-table');
  assert.deepEqual(await store.getClinicProfile('goodwell'), { slug: 'goodwell',
    displayName: 'Goodwell Demo', address: '123 Demo Road', phone: null,
    email: 'hello@example.test', revision: 3, logo: null });
  assert.equal(input.ConsistentRead, true);
  assert.deepEqual(input.Key, { pk: S('CLINIC#goodwell#CONFIG'), sk: S('PROFILE') });
  item = { ...item, clinicSlug: S('blesswell') };
  await assert.rejects(() => store.getClinicProfile('goodwell'), /Clinic profile key mismatch/);
  item = undefined;
  assert.equal(await store.getClinicProfile('goodwell'), null);
});

test('private S3 logo adapter pins branch key, metadata, content type, length and checksum', async () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9wYpaJ8AAAAASUVORK5CYII=', 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const commands = [];
  const client = { async send(command) {
    commands.push(command);
    if (command.constructor.name === 'GetObjectCommand') return { Body: { async transformToByteArray() { return bytes; } },
      ContentType: 'image/png', ContentLength: bytes.length, Metadata: { sha256 } };
    return {};
  } };
  const logos = new S3ClinicLogoStore(client, 'private-demo-logos');
  const key = await logos.put('goodwell', { bytes, contentType: 'image/png', sha256 });
  assert.match(key, /^clinics\/goodwell\/[0-9a-f-]{36}\.png$/);
  assert.equal(commands[0].input.Bucket, 'private-demo-logos');
  assert.equal(commands[0].input.CacheControl, 'no-store');
  assert.equal(commands[0].input.ServerSideEncryption, 'AES256');
  assert.deepEqual(await logos.get('goodwell', { key, contentType: 'image/png', sha256 }),
    { bytes, contentType: 'image/png' });
  await assert.rejects(() => logos.get('blesswell', { key, contentType: 'image/png', sha256 }),
    /Invalid clinic logo key/);
  await logos.removeStaged(key);
  assert.equal(commands.at(-1).constructor.name, 'DeleteObjectCommand');
});

test('temporary logo store signs an exact upload and reads only fresh bounded objects', async () => {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9wYpaJ8AAAAASUVORK5CYII=', 'base64');
  const commands = [];
  let object = { Body: { async transformToByteArray() { return bytes; } },
    ContentType: 'image/png', ContentLength: bytes.length, LastModified: new Date() };
  const client = { async send(command) {
    commands.push(command);
    if (command.constructor.name === 'GetObjectCommand') return object;
    return {};
  } };
  const logos = new S3ClinicLogoStore(client, 'approved-logos', 'pending-logos');
  const signed = await logos.preparePending('goodwell', 'image/png');
  assert.match(signed.uploadId, /^[0-9a-f-]{36}$/);
  assert.equal(signed.fields.key, `staged/goodwell/${signed.uploadId}.png`);
  assert.equal((await logos.readPending('goodwell', signed.uploadId, 'image/png')).length, bytes.length);
  assert.equal(commands[0].input.Bucket, 'pending-logos');
  object = { ...object, ContentLength: 3_000_001 };
  assert.equal(await logos.readPending('goodwell', signed.uploadId, 'image/png'), null);
  object = { ...object, ContentLength: bytes.length, LastModified: new Date(Date.now() - 11 * 60_000) };
  assert.equal(await logos.readPending('goodwell', signed.uploadId, 'image/png'), null);
  await logos.removePending('goodwell', signed.uploadId, 'image/png');
  assert.equal(commands.at(-1).input.Bucket, 'pending-logos');
  await assert.rejects(() => logos.readPending('blesswell', '../goodwell', 'image/png'), /Invalid pending/);
});
