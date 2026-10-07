import {
  DynamoDBClient, GetItemCommand, TransactWriteItemsCommand, type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import {
  MODULES, ROLES, type AuditEvent, type ClinicRecord, type ControlRepository,
  type Entitlements, type EntitlementsRecord, type Role, type StaffIdentity, type StaffRecord,
} from './core.js';

type Item = Record<string, AttributeValue>;
const s = (value: string): AttributeValue => ({ S: value });
const n = (value: number): AttributeValue => ({ N: String(value) });
const b = (value: boolean): AttributeValue => ({ BOOL: value });
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
function boolean(item: Item, field: string): boolean {
  const value = (item[field] as { BOOL?: boolean } | undefined)?.BOOL;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${field}`);
  return value;
}
function moduleMap(modules: Entitlements): AttributeValue {
  return { M: Object.fromEntries(MODULES.map((name) => [name, b(modules[name])])) };
}
function parseModules(item: Item): Entitlements {
  const map = (item.modules as { M?: Item } | undefined)?.M;
  if (!map) throw new Error('Invalid entitlements');
  return Object.fromEntries(MODULES.map((name) => [name, boolean(map, name)])) as Entitlements;
}
function auditItem(audit: AuditEvent): Item {
  return {
    pk: s(`AUDIT#${audit.clinicSlug}`), sk: s(`${audit.at}#${audit.id}`),
    actorSub: s(audit.actorSub), action: s(audit.action), target: s(audit.target), at: s(audit.at),
    changes: { M: Object.fromEntries(Object.entries(audit.changes).map(([key, value]) =>
      [key, typeof value === 'boolean' ? b(value) : typeof value === 'number' ? n(value) : s(value)])) },
  };
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
  async getClinic(slug: string): Promise<ClinicRecord | null> {
    const item = await this.get(`CLINIC#${slug}`, 'META');
    if (!item) return null;
    if (string(item, 'slug') !== slug) throw new Error('Clinic key mismatch');
    return { slug, displayName: string(item, 'displayName'), active: boolean(item, 'active'), version: integer(item, 'version') };
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
      active: boolean(item, 'active'), version: integer(item, 'version'),
    };
  }
  async getEntitlements(slug: string): Promise<EntitlementsRecord | null> {
    const item = await this.get(`CLINIC#${slug}`, 'ENTITLEMENTS');
    if (!item) return null;
    if (string(item, 'clinicSlug') !== slug) throw new Error('Entitlements key mismatch');
    return { clinicSlug: slug, modules: parseModules(item), version: integer(item, 'version') };
  }
  async createClinic(clinic: ClinicRecord, entitlements: EntitlementsRecord, audit: AuditEvent): Promise<boolean> {
    return this.transact([
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${clinic.slug}`), sk: s('META'), slug: s(clinic.slug),
        displayName: s(clinic.displayName), active: b(false), version: n(1),
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${clinic.slug}`), sk: s('ENTITLEMENTS'), clinicSlug: s(clinic.slug),
        modules: moduleMap(entitlements.modules), version: n(1),
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: auditItem(audit), ConditionExpression: 'attribute_not_exists(pk)' } },
    ]);
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
        ConditionExpression: '#clinicSlug = :slug AND #version = :expected',
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
