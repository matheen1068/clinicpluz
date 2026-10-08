import {
  DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type {
  Appointment, AuthStore, Clinic, Doctor, Entitlements, Membership, Patient,
  Role, Session, StaffIdentity, WorkflowStore, Sex, Source, AppointmentStatus, Schedule,
} from './core.js';

type Item = Record<string, AttributeValue>;
const s = (value: string): AttributeValue => ({ S: value });
const n = (value: number): AttributeValue => ({ N: String(value) });
const b = (value: boolean): AttributeValue => ({ BOOL: value });
const roles = new Set<Role>(['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing']);
const sexes = new Set<Sex>(['female', 'male', 'other', 'undisclosed']);
const sources = new Set<Source>(['phone', 'walk_in']);
const statuses = new Set<AppointmentStatus>(['booked', 'checked_in']);

function string(item: Item, name: string): string {
  const value = (item[name] as { S?: string } | undefined)?.S;
  if (!value) throw new Error(`Invalid ${name}`);
  return value;
}
function maybeString(item: Item, name: string): string | null {
  const field = item[name];
  if ((field as { NULL?: boolean } | undefined)?.NULL === true) return null;
  return string(item, name);
}
function integer(item: Item, name: string): number {
  const value = Number((item[name] as { N?: string } | undefined)?.N);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}
function bool(item: Item, name: string): boolean {
  const value = (item[name] as { BOOL?: boolean } | undefined)?.BOOL;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${name}`);
  return value;
}
function patient(item: Item): Patient {
  const sex = string(item, 'sex') as Sex;
  if (!sexes.has(sex)) throw new Error('Invalid sex');
  return { id: string(item, 'id'), fullName: string(item, 'fullName'), phone: string(item, 'phone'),
    ageYears: integer(item, 'ageYears'), sex, email: maybeString(item, 'email'), registeredAt: string(item, 'registeredAt') };
}
function patientFields(value: Patient): Item {
  return { id: s(value.id), fullName: s(value.fullName), phone: s(value.phone),
    ageYears: n(value.ageYears), sex: s(value.sex), email: value.email ? s(value.email) : { NULL: true },
    registeredAt: s(value.registeredAt) };
}
function doctor(item: Item): Doctor {
  return { id: string(item, 'id'), displayName: string(item, 'displayName'), active: bool(item, 'active') };
}
function appointment(item: Item): Appointment {
  const source = string(item, 'source') as Source;
  const status = string(item, 'status') as AppointmentStatus;
  if (!sources.has(source) || !statuses.has(status)) throw new Error('Invalid appointment state');
  return { id: string(item, 'id'), patientId: string(item, 'patientId'), patientName: string(item, 'patientName'),
    doctorId: string(item, 'doctorId'), doctorName: string(item, 'doctorName'),
    startAt: string(item, 'startAt'), startUtc: string(item, 'startUtc'), clinicDate: string(item, 'clinicDate'),
    source, status, createdAt: string(item, 'createdAt'), createdBySub: string(item, 'createdBySub') };
}

export class DynamoAuthStore implements AuthStore {
  constructor(private readonly client: DynamoDBClient, private readonly table: string) {}
  private async get(pk: string, sk: string): Promise<Item | null> {
    const response = await this.client.send(new GetItemCommand({
      TableName: this.table, Key: { pk: s(pk), sk: s(sk) }, ConsistentRead: true,
    }));
    return response.Item ?? null;
  }
  async getSession(hash: string): Promise<Session | null> {
    const item = await this.get(`SESSION#${hash}`, 'META');
    return item ? { clinicSlug: string(item, 'clinicSlug'), username: string(item, 'username'),
      sub: string(item, 'sub'), csrfToken: string(item, 'csrfToken'), expiresAt: integer(item, 'expiresAt') } : null;
  }
  async getClinic(slug: string): Promise<Clinic | null> {
    const item = await this.get(`CLINIC#${slug}`, 'META');
    if (!item) return null;
    if (string(item, 'slug') !== slug) throw new Error('Clinic key mismatch');
    return { slug, active: bool(item, 'active') };
  }
  async getMembership(slug: string, username: string): Promise<Membership | null> {
    const item = await this.get(`CLINIC#${slug}`, `STAFF#${username}`);
    if (!item) return null;
    const role = string(item, 'role') as Role;
    if (string(item, 'clinicSlug') !== slug || string(item, 'username') !== username || !roles.has(role)) {
      throw new Error('Membership key mismatch');
    }
    return { clinicSlug: slug, username, cognitoUsername: string(item, 'cognitoUsername'),
      sub: string(item, 'sub'), role, active: bool(item, 'active') };
  }
  async getEntitlements(slug: string): Promise<Entitlements | null> {
    const item = await this.get(`CLINIC#${slug}`, 'ENTITLEMENTS');
    if (!item) return null;
    if (string(item, 'clinicSlug') !== slug) throw new Error('Entitlement key mismatch');
    const map = (item.modules as { M?: Item } | undefined)?.M;
    if (!map) throw new Error('Invalid entitlements');
    return { clinicSlug: slug, patient_intake: bool(map, 'patient_intake'), appointments: bool(map, 'appointments') };
  }
}

export class CognitoStaffStatus implements StaffIdentity {
  constructor(private readonly client: CognitoIdentityProviderClient, private readonly userPoolId: string) {}
  async isActive(username: string, sub: string): Promise<boolean> {
    try {
      const user = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }));
      return Boolean(user.Enabled && user.UserStatus === 'CONFIRMED' &&
        user.UserAttributes?.some((attribute) => attribute.Name === 'sub' && attribute.Value === sub));
    } catch (error) {
      if (error instanceof Error && error.name === 'UserNotFoundException') return false;
      throw error;
    }
  }
}

export class DynamoWorkflowStore implements WorkflowStore {
  constructor(private readonly client: DynamoDBClient, private readonly table: string) {}
  private async get(pk: string, sk: string): Promise<Item | null> {
    const response = await this.client.send(new GetItemCommand({
      TableName: this.table, Key: { pk: s(pk), sk: s(sk) }, ConsistentRead: true,
    }));
    return response.Item ?? null;
  }
  private async query(pk: string, prefix: string, max: number): Promise<Item[]> {
    const response = await this.client.send(new QueryCommand({
      TableName: this.table, ConsistentRead: true,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': s(pk), ':prefix': s(prefix) }, Limit: max + 1,
    }));
    if (response.LastEvaluatedKey || (response.Items?.length ?? 0) > max) throw new Error('Result limit exceeded');
    return response.Items ?? [];
  }
  async getSchedule(slug: string): Promise<Schedule | null> {
    const item = await this.get(`CLINIC#${slug}#CONFIG`, 'SCHEDULE');
    return item ? { timezone: string(item, 'timezone'), openMinute: integer(item, 'openMinute'),
      closeMinute: integer(item, 'closeMinute'), slotMinutes: integer(item, 'slotMinutes') } : null;
  }
  async listDoctors(slug: string): Promise<Doctor[]> {
    const rows = await this.query(`CLINIC#${slug}#DOCTORS`, 'DOCTOR#', 100);
    return rows.map(doctor);
  }
  async getDoctor(slug: string, id: string): Promise<Doctor | null> {
    const item = await this.get(`CLINIC#${slug}#DOCTORS`, `DOCTOR#${id}`);
    return item ? doctor(item) : null;
  }
  async searchPatients(slug: string, kind: 'name' | 'phone', prefix: string): Promise<Patient[]> {
    const partition = kind === 'name' ? 'PATIENT_NAME' : 'PATIENT_PHONE';
    // A bounded, tenant-scoped lookup; no table Scan and no search term in URL.
    const response = await this.client.send(new QueryCommand({
      TableName: this.table, ConsistentRead: true,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': s(`CLINIC#${slug}#${partition}`), ':prefix': s(prefix) }, Limit: 20,
    }));
    return (response.Items ?? []).map(patient);
  }
  async getPatient(slug: string, id: string): Promise<Patient | null> {
    const item = await this.get(`CLINIC#${slug}#PATIENTS`, `PATIENT#${id}`);
    return item ? patient(item) : null;
  }
  async createPatient(slug: string, value: Patient, nameKey: string, phoneKey: string, actorSub: string): Promise<void> {
    const record = patientFields(value);
    await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${slug}#PATIENTS`), sk: s(`PATIENT#${value.id}`), ...record,
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${slug}#PATIENT_NAME`), sk: s(`${nameKey}#${value.id}`), ...record,
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${slug}#PATIENT_PHONE`), sk: s(`${phoneKey}#${value.id}`), ...record,
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Put: { TableName: this.table, Item: {
        pk: s(`CLINIC#${slug}#AUDIT`), sk: s(`${value.registeredAt}#${value.id}`),
        action: s('patient.registered'), actorSub: s(actorSub), targetId: s(value.id), at: s(value.registeredAt),
      }, ConditionExpression: 'attribute_not_exists(pk)' } },
    ] }));
  }
  async listAppointments(slug: string, clinicDate: string): Promise<Appointment[]> {
    const rows = await this.query(`CLINIC#${slug}#APPOINTMENTS#${clinicDate}`, 'AT#', 200);
    return rows.map(appointment);
  }
  async createAppointment(slug: string, value: Appointment): Promise<boolean> {
    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
        { ConditionCheck: { TableName: this.table,
          Key: { pk: s(`CLINIC#${slug}#PATIENTS`), sk: s(`PATIENT#${value.patientId}`) },
          ConditionExpression: 'attribute_exists(pk)',
        } },
        { ConditionCheck: { TableName: this.table,
          Key: { pk: s(`CLINIC#${slug}#DOCTORS`), sk: s(`DOCTOR#${value.doctorId}`) },
          ConditionExpression: 'attribute_exists(pk) AND #active = :true',
          ExpressionAttributeNames: { '#active': 'active' }, ExpressionAttributeValues: { ':true': b(true) },
        } },
        { Put: { TableName: this.table, Item: {
          pk: s(`CLINIC#${slug}#SLOTS#${value.doctorId}`), sk: s(`UTC#${value.startUtc}`),
          appointmentId: s(value.id), clinicDate: s(value.clinicDate),
        }, ConditionExpression: 'attribute_not_exists(pk)' } },
        { Put: { TableName: this.table, Item: {
          pk: s(`CLINIC#${slug}#APPOINTMENTS#${value.clinicDate}`), sk: s(`AT#${value.startUtc}#${value.id}`),
          id: s(value.id), patientId: s(value.patientId), patientName: s(value.patientName),
          doctorId: s(value.doctorId), doctorName: s(value.doctorName),
          startAt: s(value.startAt), startUtc: s(value.startUtc), clinicDate: s(value.clinicDate),
          source: s(value.source), status: s(value.status), createdAt: s(value.createdAt), createdBySub: s(value.createdBySub),
        }, ConditionExpression: 'attribute_not_exists(pk)' } },
        { Put: { TableName: this.table, Item: {
          pk: s(`CLINIC#${slug}#AUDIT`), sk: s(`${value.createdAt}#${value.id}`),
          action: s('appointment.created'), actorSub: s(value.createdBySub), targetId: s(value.id), at: s(value.createdAt),
        }, ConditionExpression: 'attribute_not_exists(pk)' } },
      ] }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        const reasons = (error as Error & { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
        if (reasons?.[2]?.Code === 'ConditionalCheckFailed' &&
            reasons.every((reason, index) => index === 2 || !reason.Code || reason.Code === 'None')) return false;
      }
      throw error;
    }
  }
}
