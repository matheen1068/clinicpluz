import {
  DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  MODULES, ROLES, type AuditEvent, type ClinicRecord, type ControlRepository,
  type BranchRecord, type CustomerRecord, type Entitlements, type EntitlementsRecord, type Page,
  type Role, type StaffIdentity, type StaffRecord,
} from './core.js';

type Item = Record<string, AttributeValue>;
const s = (value: string): AttributeValue => ({ S: value });
const n = (value: number): AttributeValue => ({ N: String(value) });
const b = (value: boolean): AttributeValue => ({ BOOL: value });
const nameKey = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
function string(item: Item, field: string): string {
  const value = (item[field] as { S?: string } | undefined)?.S;
  if (!value) throw new Error(`Invalid ${field}`);
  return value;
}
function integer(item: Item, field: string): number {
  const value = Number((item[field] as { N?: string } | undefined)?.N);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${field}`);
  return value;
}
function recordVersion(item: Item): number { return item.version === undefined ? 1 : integer(item, 'version'); }
function boolean(item: Item, field: string): boolean {
  const value = (item[field] as { BOOL?: boolean } | undefined)?.BOOL;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${field}`);
  return value;
}
function optionalString(item: Item, field: string): string | undefined {
  return item[field] === undefined ? undefined : string(item, field);
}
function moduleMap(modules: Entitlements): AttributeValue {
  return { M: Object.fromEntries(MODULES.map((name) => [name, b(modules[name])])) };
}
function parseModules(item: Item): Entitlements {
  const map = (item.modules as { M?: Item } | undefined)?.M;
  if (!map) throw new Error('Invalid entitlements');
  if (Object.keys(map).some((name) => !MODULES.includes(name as (typeof MODULES)[number]))) {
    throw new Error('Unknown entitlement');
  }
  return Object.fromEntries(MODULES.map((name) => [name, map[name] === undefined ? false : boolean(map, name)])) as Entitlements;
}
function auditItem(audit: AuditEvent): Item {
  return {
    pk: s(`AUDIT#${audit.clinicSlug}`), sk: s(`${audit.at}#${audit.id}`),
    actorSub: s(audit.actorSub), action: s(audit.action), target: s(audit.target), at: s(audit.at),
    changes: { M: Object.fromEntries(Object.entries(audit.changes).map(([key, value]) =>
      [key, typeof value === 'boolean' ? b(value) : typeof value === 'number' ? n(value) : s(value)])) },
  };
}
function customer(item: Item): CustomerRecord {
  const value = { id: string(item, 'id'), displayName: string(item, 'displayName'),
    createdAt: string(item, 'createdAt'), version: integer(item, 'version') };
  if (Number.isNaN(Date.parse(value.createdAt))) throw new Error('Invalid customer date');
  return value;
}
function branch(item: Item): BranchRecord {
  return { slug: string(item, 'slug'), customerId: string(item, 'customerId'),
    branchName: string(item, 'branchName'), displayName: string(item, 'displayName'),
    active: boolean(item, 'active'), version: integer(item, 'version') };
}
function branchFields(value: BranchRecord): Item {
  return { slug: s(value.slug), customerId: s(value.customerId), branchName: s(value.branchName),
    displayName: s(value.displayName), active: b(value.active), version: n(value.version) };
}
function conditionalFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return false;
  const reasons = (error as Error & { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
  return Boolean(reasons?.some((reason) => reason.Code === 'ConditionalCheckFailed') &&
    reasons.every((reason) => !reason.Code || ['None', 'ConditionalCheckFailed'].includes(reason.Code)));
}

export class DynamoControlRepository implements ControlRepository {
  constructor(private readonly client: DynamoDBClient, private readonly table: string) {}

  private async get(pk: string, sk: string): Promise<Item | null> {
    const result = await this.client.send(new GetItemCommand({
      TableName: this.table, Key: { pk: s(pk), sk: s(sk) }, ConsistentRead: true,
    }));
    return result.Item ?? null;
  }
  private async transact(items: ConstructorParameters<typeof TransactWriteItemsCommand>[0]['TransactItems']): Promise<boolean> {
    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: items }));
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }
  private async page<T>(pk: string, prefix: string, after: string | null,
    parse: (item: Item) => T): Promise<Page<T>> {
    if (after !== null && !after.startsWith(prefix)) throw new Error('Invalid directory cursor');
    const result = await this.client.send(new QueryCommand({
      TableName: this.table, ConsistentRead: true,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': s(pk), ':prefix': s(prefix) },
      Limit: 21,
      ...(after ? { ExclusiveStartKey: { pk: s(pk), sk: s(after) } } : {}),
    }));
    const rows = result.Items ?? [];
    if (rows.length > 21 || rows.some((item) => string(item, 'pk') !== pk || !string(item, 'sk').startsWith(prefix))) {
      throw new Error('Invalid directory page');
    }
    const visible = rows.slice(0, 20);
    const nextKey = rows.length > 20 ? string(visible.at(-1)!, 'sk')
      : result.LastEvaluatedKey ? string(result.LastEvaluatedKey as Item, 'sk') : null;
    return { items: visible.map(parse), nextKey };
  }
  async getCustomer(id: string): Promise<CustomerRecord | null> {
    const item = await this.get(`CUSTOMER#${id}`, 'META');
    if (!item) return null;
    const record = customer(item);
    if (record.id !== id) throw new Error('Customer key mismatch');
    return record;
  }
  async listCustomers(prefix: string, after: string | null): Promise<Page<CustomerRecord>> {
    return this.page('CONTROL#CUSTOMERS', `NAME#${prefix}`, after, (item) => {
      const record = customer(item);
      if (string(item, 'sk') !== `NAME#${nameKey(record.displayName)}#${record.id}`) {
        throw new Error('Invalid customer directory');
      }
      return record;
    });
  }
  async createCustomer(value: CustomerRecord, audit: AuditEvent): Promise<boolean> {
    const fields = { id: s(value.id), displayName: s(value.displayName),
      createdAt: s(value.createdAt), version: n(value.version) };
    return this.transact([
      { Put: { TableName: this.table, Item: { pk: s(`CUSTOMER#${value.id}`), sk: s('META'), ...fields },
        ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: { pk: s('CONTROL#CUSTOMERS'),
        sk: s(`NAME#${nameKey(value.displayName)}#${value.id}`), ...fields },
      ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: auditItem(audit), ConditionExpression: 'attribute_not_exists(pk)' } },
    ]);
  }
  async getCustomerBranch(customerId: string, branchNameKey: string): Promise<BranchRecord | null> {
    const item = await this.get(`CUSTOMER#${customerId}`, `BRANCH#${branchNameKey}`);
    if (!item) return null;
    const record = branch(item);
    if (record.customerId !== customerId || nameKey(record.branchName) !== branchNameKey) {
      throw new Error('Branch key mismatch');
    }
    return record;
  }
  async listCustomerBranches(customerId: string, after: string | null): Promise<Page<BranchRecord>> {
    return this.page(`CUSTOMER#${customerId}`, 'BRANCH#', after, (item) => {
      const record = branch(item);
      if (record.customerId !== customerId || string(item, 'sk') !== `BRANCH#${nameKey(record.branchName)}`) {
        throw new Error('Invalid branch directory');
      }
      return record;
    });
  }
  async listBranches(prefix: string, after: string | null): Promise<Page<BranchRecord>> {
    return this.page('CONTROL#BRANCHES', `SLUG#${prefix}`, after, (item) => {
      const record = branch(item);
      if (string(item, 'sk') !== `SLUG#${record.slug}`) throw new Error('Invalid branch directory');
      return record;
    });
  }
  async createBranch(value: BranchRecord, entitlements: EntitlementsRecord, audit: AuditEvent): Promise<boolean> {
    const fields = branchFields(value);
    return this.transact([
      { ConditionCheck: { TableName: this.table,
        Key: { pk: s(`CUSTOMER#${value.customerId}`), sk: s('META') },
        ConditionExpression: '#id = :id', ExpressionAttributeNames: { '#id': 'id' },
        ExpressionAttributeValues: { ':id': s(value.customerId) } } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${value.slug}`), sk: s('META'), ...fields,
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${value.slug}`), sk: s('ENTITLEMENTS'), clinicSlug: s(value.slug),
        modules: moduleMap(entitlements.modules), version: n(1),
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CUSTOMER#${value.customerId}`), sk: s(`BRANCH#${nameKey(value.branchName)}`), ...fields,
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s('CONTROL#BRANCHES'), sk: s(`SLUG#${value.slug}`), ...fields,
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: auditItem(audit), ConditionExpression: 'attribute_not_exists(pk)' } },
    ]);
  }
  async adoptLegacyBranch(value: BranchRecord, entitlements: EntitlementsRecord, audit: AuditEvent): Promise<boolean> {
    const [meta, currentEntitlements] = await Promise.all([
      this.get(`CLINIC#${value.slug}`, 'META'), this.get(`CLINIC#${value.slug}`, 'ENTITLEMENTS'),
    ]);
    if (!meta || !currentEntitlements || meta.customerId !== undefined ||
        string(meta, 'slug') !== value.slug || string(meta, 'displayName') !== value.displayName ||
        boolean(meta, 'active') !== value.active || recordVersion(meta) !== value.version ||
        string(currentEntitlements, 'clinicSlug') !== value.slug ||
        recordVersion(currentEntitlements) !== entitlements.version) return false;
    const oldModules = (currentEntitlements.modules as { M?: Item } | undefined)?.M;
    if (!oldModules) return false;
    const parsed = parseModules(currentEntitlements);
    if (MODULES.some((name) => parsed[name] !== entitlements.modules[name])) return false;
    const fields = branchFields(value);
    const legacyVersion = (actual: Item) => actual.version === undefined
      ? '(attribute_not_exists(#version))' : '#version = :expected';
    return this.transact([
      { ConditionCheck: { TableName: this.table,
        Key: { pk: s(`CUSTOMER#${value.customerId}`), sk: s('META') },
        ConditionExpression: '#id = :id', ExpressionAttributeNames: { '#id': 'id' },
        ExpressionAttributeValues: { ':id': s(value.customerId) } } },
      { Update: { TableName: this.table,
        Key: { pk: s(`CLINIC#${value.slug}`), sk: s('META') },
        UpdateExpression: 'SET #customerId = :customer, #branchName = :branch, #version = :expected',
        ConditionExpression: `#slug = :slug AND #displayName = :display AND #active = :active AND ` +
          `attribute_not_exists(#customerId) AND ${legacyVersion(meta)}`,
        ExpressionAttributeNames: { '#customerId': 'customerId', '#branchName': 'branchName',
          '#version': 'version', '#slug': 'slug', '#displayName': 'displayName', '#active': 'active' },
        ExpressionAttributeValues: { ':customer': s(value.customerId), ':branch': s(value.branchName),
          ':expected': n(value.version), ':slug': s(value.slug), ':display': s(value.displayName),
          ':active': b(value.active) } } },
      { Update: { TableName: this.table,
        Key: { pk: s(`CLINIC#${value.slug}`), sk: s('ENTITLEMENTS') },
        UpdateExpression: 'SET #modules = :modules, #version = :expected',
        ConditionExpression: `#clinicSlug = :slug AND #modules = :oldModules AND ${legacyVersion(currentEntitlements)}`,
        ExpressionAttributeNames: { '#clinicSlug': 'clinicSlug', '#modules': 'modules', '#version': 'version' },
        ExpressionAttributeValues: { ':slug': s(value.slug), ':oldModules': currentEntitlements.modules,
          ':modules': moduleMap(entitlements.modules), ':expected': n(entitlements.version) } } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CUSTOMER#${value.customerId}`), sk: s(`BRANCH#${nameKey(value.branchName)}`), ...fields,
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s('CONTROL#BRANCHES'), sk: s(`SLUG#${value.slug}`), ...fields,
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: auditItem(audit), ConditionExpression: 'attribute_not_exists(pk)' } },
    ]);
  }
  async getClinic(slug: string): Promise<ClinicRecord | null> {
    const item = await this.get(`CLINIC#${slug}`, 'META');
    if (!item) return null;
    if (string(item, 'slug') !== slug) throw new Error('Clinic key mismatch');
    const customerId = optionalString(item, 'customerId');
    const branchName = optionalString(item, 'branchName');
    if (Boolean(customerId) !== Boolean(branchName)) throw new Error('Incomplete branch ownership');
    return { slug, displayName: string(item, 'displayName'), active: boolean(item, 'active'),
      version: recordVersion(item), ...(customerId ? { customerId, branchName } : {}) };
  }
  async getStaff(slug: string, username: string): Promise<StaffRecord | null> {
    const item = await this.get(`CLINIC#${slug}`, `STAFF#${username}`);
    if (!item) return null;
    if (string(item, 'clinicSlug') !== slug || string(item, 'username') !== username) throw new Error('Staff key mismatch');
    const role = string(item, 'role') as Role;
    if (!ROLES.includes(role)) throw new Error('Invalid staff role');
    return {
      clinicSlug: slug, username, cognitoUsername: string(item, 'cognitoUsername'),
      sub: string(item, 'sub'), displayName: string(item, 'displayName'), role,
      active: boolean(item, 'active'), version: recordVersion(item),
    };
  }
  async listStaff(slug: string, after: string | null): Promise<Page<StaffRecord>> {
    return this.page(`CLINIC#${slug}`, 'STAFF#', after, (item) => {
      const username = string(item, 'username');
      if (string(item, 'sk') !== `STAFF#${username}` || string(item, 'clinicSlug') !== slug) {
        throw new Error('Invalid staff directory');
      }
      const role = string(item, 'role') as Role;
      if (!ROLES.includes(role)) throw new Error('Invalid staff role');
      return { clinicSlug: slug, username, cognitoUsername: string(item, 'cognitoUsername'),
        sub: string(item, 'sub'), displayName: string(item, 'displayName'), role,
        active: boolean(item, 'active'), version: recordVersion(item) };
    });
  }
  async getEntitlements(slug: string): Promise<EntitlementsRecord | null> {
    const item = await this.get(`CLINIC#${slug}`, 'ENTITLEMENTS');
    if (!item) return null;
    if (string(item, 'clinicSlug') !== slug) throw new Error('Entitlements key mismatch');
    return { clinicSlug: slug, modules: parseModules(item), version: recordVersion(item) };
  }
  async createStaff(staff: StaffRecord, audit: AuditEvent): Promise<boolean> {
    return this.transact([
      { ConditionCheck: { TableName: this.table, Key: { pk: s(`CLINIC#${staff.clinicSlug}`), sk: s('META') },
        ConditionExpression: 'attribute_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${staff.clinicSlug}`), sk: s(`STAFF#${staff.username}`),
        clinicSlug: s(staff.clinicSlug), username: s(staff.username),
        cognitoUsername: s(staff.cognitoUsername), sub: s(staff.sub), displayName: s(staff.displayName),
        role: s(staff.role), active: b(staff.active), version: n(1),
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: auditItem(audit), ConditionExpression: 'attribute_not_exists(pk)' } },
    ]);
  }
  async replaceStaff(staff: StaffRecord, expectedVersion: number, requireInactiveClinic: boolean, audit: AuditEvent): Promise<boolean> {
    const items: NonNullable<ConstructorParameters<typeof TransactWriteItemsCommand>[0]['TransactItems']> = [];
    if (requireInactiveClinic) items.push({ ConditionCheck: {
      TableName: this.table, Key: { pk: s(`CLINIC#${staff.clinicSlug}`), sk: s('META') },
      ConditionExpression: '#slug = :slug AND #active = :false',
      ExpressionAttributeNames: { '#slug': 'slug', '#active': 'active' },
      ExpressionAttributeValues: { ':slug': s(staff.clinicSlug), ':false': b(false) },
    } });
    items.push(
      { Update: { TableName: this.table, Key: { pk: s(`CLINIC#${staff.clinicSlug}`), sk: s(`STAFF#${staff.username}`) },
        UpdateExpression: 'SET #name = :name, #role = :role, #active = :active, #version = :next',
        ConditionExpression: '#clinicSlug = :slug AND ' +
          (expectedVersion === 1 ? '(#version = :expected OR attribute_not_exists(#version))' : '#version = :expected'),
        ExpressionAttributeNames: { '#name': 'displayName', '#role': 'role', '#active': 'active',
          '#version': 'version', '#clinicSlug': 'clinicSlug' },
        ExpressionAttributeValues: {
          ':name': s(staff.displayName), ':role': s(staff.role), ':active': b(staff.active),
          ':next': n(staff.version), ':expected': n(expectedVersion), ':slug': s(staff.clinicSlug),
        } } },
      { Put: { TableName: this.table, Item: auditItem(audit), ConditionExpression: 'attribute_not_exists(pk)' } },
    );
    return this.transact(items);
  }
  async replaceEntitlements(record: EntitlementsRecord, expectedVersion: number, audit: AuditEvent): Promise<boolean> {
    return this.transact([
      { Update: { TableName: this.table, Key: { pk: s(`CLINIC#${record.clinicSlug}`), sk: s('ENTITLEMENTS') },
        UpdateExpression: 'SET #modules = :modules, #version = :next',
        ConditionExpression: '#clinicSlug = :slug AND #version = :expected',
        ExpressionAttributeNames: { '#modules': 'modules', '#version': 'version', '#clinicSlug': 'clinicSlug' },
        ExpressionAttributeValues: {
          ':modules': moduleMap(record.modules), ':next': n(record.version),
          ':expected': n(expectedVersion), ':slug': s(record.clinicSlug),
        } } },
      { Put: { TableName: this.table, Item: auditItem(audit), ConditionExpression: 'attribute_not_exists(pk)' } },
    ]);
  }
  async setClinicState(clinic: ClinicRecord, expectedVersion: number, adminUsername: string | null, audit: AuditEvent): Promise<boolean> {
    const items: NonNullable<ConstructorParameters<typeof TransactWriteItemsCommand>[0]['TransactItems']> = [];
    if (clinic.active && adminUsername) items.push({ ConditionCheck: {
      TableName: this.table, Key: { pk: s(`CLINIC#${clinic.slug}`), sk: s(`STAFF#${adminUsername}`) },
      ConditionExpression: '#clinicSlug = :slug AND #role = :admin AND #active = :true',
      ExpressionAttributeNames: { '#clinicSlug': 'clinicSlug', '#role': 'role', '#active': 'active' },
      ExpressionAttributeValues: { ':slug': s(clinic.slug), ':admin': s('clinic_admin'), ':true': b(true) },
    } });
    items.push({ Update: {
      TableName: this.table, Key: { pk: s(`CLINIC#${clinic.slug}`), sk: s('META') },
      UpdateExpression: 'SET #active = :active, #version = :next',
      ConditionExpression: '#slug = :slug AND #version = :expected',
      ExpressionAttributeNames: { '#active': 'active', '#version': 'version', '#slug': 'slug' },
      ExpressionAttributeValues: {
        ':active': b(clinic.active), ':next': n(clinic.version),
        ':expected': n(expectedVersion), ':slug': s(clinic.slug),
      },
    } });
    if (clinic.customerId && clinic.branchName) {
      for (const key of [
        { pk: `CUSTOMER#${clinic.customerId}`, sk: `BRANCH#${nameKey(clinic.branchName)}` },
        { pk: 'CONTROL#BRANCHES', sk: `SLUG#${clinic.slug}` },
      ]) items.push({ Update: {
        TableName: this.table, Key: { pk: s(key.pk), sk: s(key.sk) },
        UpdateExpression: 'SET #active = :active, #version = :next',
        ConditionExpression: '#slug = :slug AND #customerId = :customer AND #version = :expected',
        ExpressionAttributeNames: { '#active': 'active', '#version': 'version',
          '#slug': 'slug', '#customerId': 'customerId' },
        ExpressionAttributeValues: { ':active': b(clinic.active), ':next': n(clinic.version),
          ':slug': s(clinic.slug), ':customer': s(clinic.customerId), ':expected': n(expectedVersion) },
      } });
    }
    items.push({ Put: { TableName: this.table, Item: auditItem(audit), ConditionExpression: 'attribute_not_exists(pk)' } });
    return this.transact(items);
  }
}

export class CognitoStaffLookup implements StaffIdentity {
  constructor(private readonly client: CognitoIdentityProviderClient, private readonly userPoolId: string) {}
  async lookup(cognitoUsername: string): Promise<{ sub: string } | null> {
    try {
      const user = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: cognitoUsername }));
      const sub = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
      return user.Enabled && user.UserStatus === 'CONFIRMED' && sub ? { sub } : null;
    } catch (error) {
      if (error instanceof Error && error.name === 'UserNotFoundException') return null;
      throw error;
    }
  }
}
