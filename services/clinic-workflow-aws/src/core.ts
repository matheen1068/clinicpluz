import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { EMPTY_NOTE, medicationForDisplay, parseMedications, parseNote, parseVitals, readyToFinalize,
  type Encounter } from './consultation.ts';
import { historyIdFor, validHistoryId, type HistoryEntry } from './history.ts';
import { renderPrescriptionPdf, UnsupportedPrescriptionText } from './prescription-pdf.ts';
import { handleBilling } from './billing-routes.ts';
import type { BillingStore } from './billing.ts';

export type Role = 'clinic_admin' | 'doctor' | 'receptionist' | 'nurse' | 'lab_tech' | 'billing' | 'pharmacist';
export type Sex = 'female' | 'male' | 'other' | 'undisclosed';
export type Source = 'phone' | 'walk_in';
export type AppointmentStatus = 'booked' | 'checked_in';
export interface Session { clinicSlug: string; username: string; sub: string; csrfToken: string; expiresAt: number }
export interface Clinic { slug: string; active: boolean; displayName?: string }
export interface Membership { clinicSlug: string; username: string; cognitoUsername: string; sub: string; role: Role; active: boolean; displayName?: string }
export interface Entitlements { clinicSlug: string; patient_intake: boolean; appointments: boolean; consultations: boolean; billing?: boolean }
export interface Doctor { id: string; displayName: string; active: boolean; staffSub?: string }
export interface MedicineCatalogItem { id: string; name: string; strength: string; active: boolean; favorite: boolean }
export interface Schedule { timezone: string; openMinute: number; closeMinute: number; slotMinutes: number }
export interface Patient {
  id: string; fullName: string; phone: string; ageYears: number; sex: Sex;
  email: string | null; contactPatientId: string | null; registeredAt: string;
}
export interface Appointment {
  id: string; patientId: string; patientName: string; doctorId: string; doctorName: string;
  startAt: string; startUtc: string; clinicDate: string; source: Source; status: AppointmentStatus;
  createdAt: string; createdBySub: string;
}
export interface AuthStore {
  getSession(hash: string): Promise<Session | null>;
  getClinic(slug: string): Promise<Clinic | null>;
  getMembership(slug: string, username: string): Promise<Membership | null>;
  getEntitlements(slug: string): Promise<Entitlements | null>;
}
export interface StaffIdentity { isActive(cognitoUsername: string, sub: string): Promise<boolean> }
export interface WorkflowStore {
  getSchedule(slug: string): Promise<Schedule | null>;
  listDoctors(slug: string): Promise<Doctor[]>;
  listMedicines(slug: string): Promise<MedicineCatalogItem[]>;
  getDoctor(slug: string, id: string): Promise<Doctor | null>;
  searchPatients(slug: string, kind: 'name' | 'phone', prefix: string): Promise<Patient[]>;
  getPatient(slug: string, id: string): Promise<Patient | null>;
  createPatient(slug: string, patient: Patient, nameKey: string, phoneKey: string, actorSub: string,
    contact: Pick<Patient, 'id' | 'phone'> | null): Promise<void>;
  listAppointments(slug: string, clinicDate: string): Promise<Appointment[]>;
  createAppointment(slug: string, appointment: Appointment): Promise<boolean>;
  getEncounter(slug: string, clinicDate: string, appointmentId: string): Promise<Encounter | null>;
  listPatientHistory(slug: string, patientId: string, before: string, limit: number): Promise<HistoryEntry[]>;
  getHistoryEntry(slug: string, patientId: string, historyId: string): Promise<HistoryEntry | null>;
  listEncounterStatuses(slug: string, clinicDate: string): Promise<Map<string, 'draft' | 'finalized'>>;
  saveEncounter(slug: string, appointment: Appointment, encounter: Encounter,
    expectedRevision: number, actorSub: string, action: 'vitals.saved' | 'draft.saved' | 'encounter.finalized',
    assignedDoctorSub?: string): Promise<boolean>;
  claimPrescriptionEmail(slug: string, appointmentId: string, revision: number,
    recipientHash: string, actorSub: string, at: string,
    context: { clinicDate: string; patientId: string; doctorId: string; storedEmail: string }):
    Promise<'claimed' | 'pending' | 'accepted' | 'unknown' | 'recipient_changed' | 'stored_email_changed'>;
  markPrescriptionEmail(slug: string, appointmentId: string, revision: number,
    status: 'accepted' | 'unknown', at: string, messageId?: string): Promise<void>;
}
export interface HttpInput {
  method: string; path: string; queryString?: string; headers: Record<string, string | undefined>;
  cookies?: string[]; body?: string; isBase64Encoded?: boolean;
}
export interface HttpResult { statusCode: number; headers: Record<string, string>; body: string }
export interface PrescriptionEmailConfig {
  allowedRecipient: string;
  send(to: string, pdf: Uint8Array): Promise<string>;
}
export interface Config { publicOrigin: string; edgeKey: string; now?: () => Date; prescriptionEmail?: PrescriptionEmailConfig }

const ROLES = new Set<Role>(['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing', 'pharmacist']);
const PRESCRIPTION_ROLES = new Set<Role>(['clinic_admin', 'receptionist', 'pharmacist']);
const PRESCRIPTION_EMAIL_ROLES = new Set<Role>(['clinic_admin', 'receptionist']);

function emailFailureMetadata(error: unknown): { name: string; httpStatusCode?: number; requestId?: string } {
  if (!error || typeof error !== 'object') return { name: 'UnknownError' };
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown; requestId?: unknown } };
  const name = typeof candidate.name === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(candidate.name)
    ? candidate.name : 'UnknownError';
  const httpStatusCode = typeof candidate.$metadata?.httpStatusCode === 'number'
    ? candidate.$metadata.httpStatusCode : undefined;
  const requestId = typeof candidate.$metadata?.requestId === 'string' &&
    /^[A-Za-z0-9-]{1,128}$/.test(candidate.$metadata.requestId)
    ? candidate.$metadata.requestId : undefined;
  return { name, ...(httpStatusCode ? { httpStatusCode } : {}), ...(requestId ? { requestId } : {}) };
}
const VIEW_ROLES = new Set<Role>(['clinic_admin', 'receptionist', 'nurse']);
const WRITE_ROLES = new Set<Role>(['clinic_admin', 'receptionist', 'nurse']);
const RESERVED = new Set(['admin', 'api', 'app', 'control', 'controlpanel', 'staging', 'www']);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_COOKIE = '__Host-cpz_session';
const SEXES = new Set<Sex>(['female', 'male', 'other', 'undisclosed']);
const SOURCE = new Set<Source>(['phone', 'walk_in']);

function result(statusCode: number, value: unknown): HttpResult {
  return { statusCode, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  }, body: JSON.stringify(value) };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOnly(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => key in value) && Object.keys(value).every((key) => [...required, ...optional].includes(key));
}
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
function readCookie(input: HttpInput): string | null {
  const header = input.cookies ? input.cookies.join('; ') : input.headers.cookie ?? '';
  let found: string | null = null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(at + 1).trim();
    if (found !== null || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) return null;
    found = value;
  }
  return found;
}
function slug(value: string): boolean {
  return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && !RESERVED.has(value);
}
function body(input: HttpInput, maxLength = 4096): Record<string, unknown> | null {
  if (input.isBase64Encoded || !input.headers['content-type']?.toLowerCase().startsWith('application/json') ||
      !input.body || input.body.length > maxLength) return null;
  try { const value: unknown = JSON.parse(input.body); return object(value) ? value : null; }
  catch { return null; }
}
function singleQuery(raw: string | undefined, name: string): string | null {
  const query = new URLSearchParams(raw ?? '');
  return [...query.keys()].length === 1 && query.getAll(name).length === 1 ? query.get(name) : null;
}
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length >= 2 && clean.length <= 120 && /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .'-]*$/u.test(clean) ? clean : null;
}
function nameIndex(value: string): string { return value.normalize('NFKC').toLocaleLowerCase('en-US'); }
function phone(value: unknown): { display: string; digits: string } | null {
  if (typeof value !== 'string' || !/^\+?[0-9][0-9 ()-]{5,22}$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? { display: value.trim(), digits } : null;
}
function email(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().toLowerCase();
  return clean.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : undefined;
}
function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function startTime(value: unknown, schedule: Schedule): { startAt: string; startUtc: string; clinicDate: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00(?:\.0{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || !calendarDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59) return null;
  if (match[4] && (Number(match[5]) > 14 || Number(match[6]) > 59 ||
      (Number(match[5]) === 14 && Number(match[6]) !== 0))) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || schedule.slotMinutes !== 30 ||
      !Number.isInteger(schedule.openMinute) || !Number.isInteger(schedule.closeMinute) ||
      schedule.openMinute < 0 || schedule.closeMinute > 1440 || schedule.openMinute >= schedule.closeMinute) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(parsed);
  const field = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  const localDate = `${field('year')}-${field('month')}-${field('day')}`;
  const hour = Number(field('hour'));
  const minute = Number(field('minute'));
  const localMinute = hour * 60 + minute;
  if (localMinute % 30 !== 0 || localMinute < schedule.openMinute || localMinute + 30 > schedule.closeMinute) return null;
  return { startAt: value, startUtc: parsed.toISOString(), clinicDate: localDate };
}
function publicPatient(patient: Patient) {
  const { id, fullName, phone, ageYears, sex, email, contactPatientId } = patient;
  return { id, fullName, phone, ageYears, sex, email, contactPatientId: contactPatientId ?? null };
}
function publicAppointment(appointment: Appointment) {
  const { id, patientId, patientName, doctorId, doctorName, startAt, source, status } = appointment;
  return { id, patientId, patientName, doctorId, doctorName, startAt, source, status };
}
function printablePrescription(encounter: Encounter, clinic: Clinic, patient: Patient) {
  if (encounter.status !== 'finalized' || encounter.medications.length === 0) return undefined;
  if (!encounter.finalizedAt || !encounter.finalizedBySub || !encounter.finalizedByDisplayName ||
      encounter.finalizedDoctorId !== encounter.doctorId) throw new Error('Finalized clinician identity unavailable');
  return {
    clinic: { slug: clinic.slug, displayName: clinic.displayName ?? clinic.slug },
    doctor: { id: encounter.finalizedDoctorId, displayName: encounter.finalizedByDisplayName },
    patient: { id: patient.id, fullName: patient.fullName, ageYears: patient.ageYears, sex: patient.sex },
    appointmentDate: encounter.clinicDate, finalizedAt: encounter.finalizedAt,
    medications: encounter.medications.map(medicationForDisplay),
  };
}
function finalizedPrescriptionMatches(encounter: Encounter | null, appointment: Appointment): encounter is Encounter {
  return Boolean(encounter && encounter.appointmentId === appointment.id &&
    encounter.clinicDate === appointment.clinicDate && encounter.patientId === appointment.patientId &&
    encounter.doctorId === appointment.doctorId && encounter.status === 'finalized' &&
    encounter.finalizedAt && encounter.finalizedBySub && encounter.finalizedByDisplayName &&
    encounter.finalizedDoctorId === appointment.doctorId && Array.isArray(encounter.medications) &&
    encounter.medications.every((medication) => medication.encounterAppointmentId === appointment.id &&
      medication.prescriberSub === encounter.finalizedBySub));
}
async function resolveFinalizedPrescription(store: WorkflowStore, clinicSlug: string,
  appointmentId: string, clinicDate: string): Promise<{ appointment: Appointment; patient: Patient; encounter: Encounter } | null> {
  const appointments = await store.listAppointments(clinicSlug, clinicDate);
  const appointment = appointments.find((row) => row.id === appointmentId && row.clinicDate === clinicDate);
  if (!appointment) return null;
  const [patient, encounter] = await Promise.all([
    store.getPatient(clinicSlug, appointment.patientId),
    store.getEncounter(clinicSlug, appointment.clinicDate, appointment.id),
  ]);
  if (!patient || patient.id !== appointment.patientId) throw new Error('Invalid patient link');
  if (!encounter || encounter.status !== 'finalized' || encounter.medications.length === 0) return null;
  if (!finalizedPrescriptionMatches(encounter, appointment)) throw new Error('Invalid finalized prescription');
  return { appointment, patient, encounter };
}
function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  return `${value[0]}***${value.slice(at)}`;
}
function consultationResponse(encounter: Encounter, clinic: Clinic, patient: Patient, doctor: Doctor, role: Role) {
  if (encounter.status === 'finalized' && (!encounter.finalizedBySub || !encounter.finalizedByDisplayName ||
      encounter.finalizedDoctorId !== encounter.doctorId)) throw new Error('Finalized clinician identity unavailable');
  const shownDoctor = encounter.status === 'finalized' ?
    { id: encounter.finalizedDoctorId!, displayName: encounter.finalizedByDisplayName! } :
    { id: doctor.id, displayName: doctor.displayName };
  const publicEncounter: Record<string, unknown> = {
    appointmentId: encounter.appointmentId, clinicDate: encounter.clinicDate,
    status: encounter.status, revision: encounter.revision, vitals: encounter.vitals,
    finalizedAt: encounter.finalizedAt,
    patient: { id: patient.id, fullName: patient.fullName, ageYears: patient.ageYears, sex: patient.sex },
    doctor: shownDoctor,
    clinic: { slug: clinic.slug, displayName: clinic.displayName ?? clinic.slug },
  };
  if (role !== 'doctor') return { encounter: publicEncounter };
  publicEncounter.note = encounter.note;
  publicEncounter.medications = encounter.medications.map(medicationForDisplay);
  const prescription = printablePrescription(encounter, clinic, patient);
  return prescription ? { encounter: publicEncounter, printablePrescription: prescription } : { encounter: publicEncounter };
}

interface HistoryCursor {
  v: 1; clinicSlug: string; patientId: string; appointmentId: string;
  cutoff: string; before: string; expiresAt: number;
}
function encodeHistoryCursor(cursor: HistoryCursor, key: string): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  const signature = createHmac('sha256', key).update(`patient-history-cursor-v1:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}
function decodeHistoryCursor(token: unknown, key: string, context: Omit<HistoryCursor, 'v' | 'before' | 'expiresAt'>,
  nowSeconds: number): string | null {
  if (typeof token !== 'string' || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', key).update(`patient-history-cursor-v1:${payload}`).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!object(parsed) || !hasOnly(parsed, ['v', 'clinicSlug', 'patientId', 'appointmentId',
    'cutoff', 'before', 'expiresAt']) || parsed.v !== 1 || parsed.clinicSlug !== context.clinicSlug ||
      parsed.patientId !== context.patientId || parsed.appointmentId !== context.appointmentId ||
      parsed.cutoff !== context.cutoff || !validHistoryId(parsed.before) ||
      parsed.before >= context.cutoff || !Number.isSafeInteger(parsed.expiresAt) ||
      typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= nowSeconds ||
      parsed.expiresAt > nowSeconds + 900) return null;
  return parsed.before;
}
function historySummary(entry: HistoryEntry) {
  return { historyId: entry.historyId, clinicSlug: entry.clinicSlug, patientId: entry.patientId,
    status: entry.status, visitAt: entry.visitAt, finalizedAt: entry.finalizedAt, doctor: entry.doctor };
}
function historyMatchesEncounter(entry: HistoryEntry, encounter: Encounter | null): encounter is Encounter {
  return Boolean(encounter && encounter.status === 'finalized' && encounter.patientId === entry.patientId &&
    encounter.appointmentId === entry.appointmentId && encounter.clinicDate === entry.clinicDate &&
    encounter.finalizedAt === entry.finalizedAt && encounter.finalizedDoctorId === entry.doctor.id &&
    encounter.finalizedByDisplayName === entry.doctor.displayName);
}

export function createWorkflowApp(auth: AuthStore, identity: StaffIdentity, store: WorkflowStore, config: Config,
  billing?: BillingStore) {
  const origin = new URL(config.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== config.publicOrigin ||
      !/^[a-z0-9-]+\.cloudfront\.net$/.test(origin.hostname) || config.edgeKey.length < 32) {
    throw new Error('Invalid staging workflow configuration');
  }
  if (config.prescriptionEmail && (email(config.prescriptionEmail.allowedRecipient) !==
      config.prescriptionEmail.allowedRecipient || typeof config.prescriptionEmail.send !== 'function')) {
    throw new Error('Invalid staging prescription email configuration');
  }
  const now = config.now ?? (() => new Date());

  return {
    async handle(input: HttpInput): Promise<HttpResult> {
      try {
        if (!safeEqual(input.headers['x-clinicpluz-edge-key'] ?? '', config.edgeKey)) return result(403, { error: 'Forbidden' });
        if (input.headers.origin && input.headers.origin !== config.publicOrigin) return result(403, { error: 'Origin rejected' });
        const match = /^\/api\/workflow\/clinics\/([a-z0-9-]+)\/(dashboard|doctors|patients(?:\/search)?|appointments(?:\/check-in)?|billing\/(?:config|episodes|read|consultation-fee\/read|consultation-charge|fulfillment(?:\/read)?|payments|receipt)|consultations(?:\/(?:read|vitals|draft|finalize|medicines\/search|history\/(?:list|detail)|prescriptions(?:\/read|\/email(?:\/preview)?)?))?)$/.exec(input.path);
        if (!match || !slug(match[1])) return result(404, { error: 'Not found' });
        const clinicSlug = match[1];
        const endpoint = match[2];
        if (input.method !== 'GET' && input.method !== 'POST') return result(404, { error: 'Not found' });

        const cookie = readCookie(input);
        if (!cookie) return result(401, { error: 'Not signed in' });
        const session = await auth.getSession(createHash('sha256').update(cookie).digest('hex'));
        if (!session || session.expiresAt <= Math.floor(now().getTime() / 1000)) return result(401, { error: 'Not signed in' });
        if (session.clinicSlug !== clinicSlug) return result(403, { error: 'Clinic session mismatch' });
        const [clinic, member, modules] = await Promise.all([
          auth.getClinic(clinicSlug), auth.getMembership(clinicSlug, session.username), auth.getEntitlements(clinicSlug),
        ]);
        if (!clinic?.active || clinic.slug !== clinicSlug || !member?.active || member.clinicSlug !== clinicSlug ||
            member.username !== session.username || member.sub !== session.sub || !ROLES.has(member.role) ||
            !(await identity.isActive(member.cognitoUsername, member.sub))) return result(403, { error: 'Clinic access denied' });
        const isConsultation = endpoint.startsWith('consultations');
        const isPrescriptionHandoff = endpoint === 'consultations/prescriptions' ||
          endpoint === 'consultations/prescriptions/read';
        const isPrescriptionEmail = endpoint === 'consultations/prescriptions/email' ||
          endpoint === 'consultations/prescriptions/email/preview';
        const isBilling = endpoint.startsWith('billing/') || endpoint === 'appointments/check-in';
        const module = isBilling ? 'billing' : isConsultation ? 'consultations' : endpoint.startsWith('patients') ? 'patient_intake' : 'appointments';
        if (!modules || modules.clinicSlug !== clinicSlug || modules[module] !== true) return result(403, { error: 'Module unavailable' });
        if (isBilling) {
          const doctorFee = endpoint === 'billing/consultation-fee/read' || endpoint === 'billing/consultation-charge';
          if (endpoint.startsWith('billing/fulfillment') ? member.role !== 'pharmacist' :
              member.role !== 'clinic_admin' && member.role !== 'receptionist' &&
              !(doctorFee && member.role === 'doctor')) {
            return result(403, { error: 'Role not allowed' });
          }
          if (endpoint.startsWith('billing/fulfillment') && modules.consultations !== true) {
            return result(403, { error: 'Module unavailable' });
          }
        } else if (isConsultation) {
          const vitalStaff = (member.role === 'receptionist' || member.role === 'clinic_admin') &&
            (endpoint === 'consultations' || endpoint === 'consultations/read' || endpoint === 'consultations/vitals');
          if (isPrescriptionEmail ? !PRESCRIPTION_EMAIL_ROLES.has(member.role) :
              isPrescriptionHandoff ? !PRESCRIPTION_ROLES.has(member.role) :
                member.role !== 'nurse' && member.role !== 'doctor' && !vitalStaff) {
            return result(403, { error: 'Role not allowed' });
          }
          if ((endpoint === 'consultations/draft' || endpoint === 'consultations/finalize' ||
              endpoint === 'consultations/medicines/search' || endpoint.startsWith('consultations/history/')) &&
              member.role !== 'doctor') {
            return result(403, { error: 'Role not allowed' });
          }
        } else if (endpoint === 'dashboard') {
          if (member.role !== 'clinic_admin' && member.role !== 'receptionist' && member.role !== 'doctor') {
            return result(403, { error: 'Role not allowed' });
          }
          if (member.role === 'doctor' && modules.consultations !== true) {
            return result(403, { error: 'Module unavailable' });
          }
        } else {
          const viewing = input.method === 'GET' || endpoint === 'patients/search';
          if (!(viewing ? VIEW_ROLES : WRITE_ROLES).has(member.role)) return result(403, { error: 'Role not allowed' });
        }
        if (input.method === 'POST' && (input.headers.origin !== config.publicOrigin ||
            !safeEqual(input.headers['x-csrf-token'] ?? '', session.csrfToken))) return result(403, { error: 'CSRF rejected' });
        if (isPrescriptionEmail && input.method !== 'POST') return result(404, { error: 'Not found' });
        if (isPrescriptionHandoff &&
            (endpoint === 'consultations/prescriptions' ? input.method !== 'GET' : input.method !== 'POST')) {
          return result(404, { error: 'Not found' });
        }

        if (isBilling) return handleBilling(input, endpoint, clinicSlug, clinic, member, store, billing, now());

        if (endpoint === 'dashboard' && input.method === 'GET') {
          const date = singleQuery(input.queryString, 'date');
          if (!date || !calendarDate(date)) return result(400, { error: 'Invalid date' });
          const [appointments, statuses] = await Promise.all([
            store.listAppointments(clinicSlug, date), store.listEncounterStatuses(clinicSlug, date),
          ]);
          let visible = appointments;
          if (member.role === 'doctor') {
            const assigned = new Set((await store.listDoctors(clinicSlug))
              .filter((doctor) => doctor.active && doctor.staffSub === member.sub).map((doctor) => doctor.id));
            visible = appointments.filter((appointment) => assigned.has(appointment.doctorId));
          }
          const counts = { total: visible.length, booked: 0, checkedIn: 0, pending: 0,
            completed: 0, phone: 0, walkIn: 0 };
          for (const appointment of visible) {
            const finalized = statuses.get(appointment.id) === 'finalized';
            if (appointment.status === 'checked_in') counts.checkedIn += 1;
            if (appointment.source === 'phone') counts.phone += 1;
            else counts.walkIn += 1;
            if (finalized) counts.completed += 1;
            else if (appointment.status === 'checked_in') counts.pending += 1;
            else counts.booked += 1;
          }
          return result(200, { date, scope: member.role === 'doctor' ? 'doctor' : 'clinic', counts });
        }

        if (input.method === 'GET' && endpoint === 'doctors' && !(input.queryString ?? '')) {
          const doctors = await store.listDoctors(clinicSlug);
          return result(200, { items: doctors.filter((doctor) => doctor.active).map(({ id, displayName }) => ({ id, displayName })) });
        }
        if (input.method === 'POST' && endpoint === 'consultations/medicines/search' && !(input.queryString ?? '')) {
          const request = body(input, 256);
          if (!request || !hasOnly(request, ['query']) || typeof request.query !== 'string') {
            return result(400, { error: 'Invalid medicine search' });
          }
          const query = request.query.trim().replace(/\s+/g, ' ').normalize('NFKC').toLocaleLowerCase('en-US');
          if (query.length < 2 || query.length > 64 || !/^[\p{L}\p{M}\p{N} .'-]+$/u.test(query)) {
            return result(400, { error: 'Invalid medicine search' });
          }
          const medicines = await store.listMedicines(clinicSlug);
          const items = medicines.filter((item) => item.active &&
            `${item.name} ${item.strength}`.normalize('NFKC').toLocaleLowerCase('en-US').includes(query))
            .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name) || a.strength.localeCompare(b.strength))
            .slice(0, 20)
            .map(({ id, name, strength, favorite }) => ({ id, name, strength, favorite }));
          return result(200, { items });
        }
        if (input.method === 'POST' && endpoint === 'patients/search' && !(input.queryString ?? '')) {
          const request = body(input);
          if (!request || !hasOnly(request, ['query']) || typeof request.query !== 'string') {
            return result(400, { error: 'Invalid patient search' });
          }
          const raw = request.query;
          if (!raw || raw.length > 80) return result(400, { error: 'Invalid patient search' });
          const digits = raw.replace(/\D/g, '');
          const isPhone = /^[+0-9 ()-]+$/.test(raw);
          const term = isPhone ? digits : nameIndex(raw.trim().replace(/\s+/g, ' '));
          if (term.length < 2 || term.length > 80 || (!isPhone && !/^[\p{L}\p{M}\p{N} .'-]+$/u.test(term))) {
            return result(400, { error: 'Invalid patient search' });
          }
          const patients = await store.searchPatients(clinicSlug, isPhone ? 'phone' : 'name', term);
          return result(200, { items: patients.map(publicPatient) });
        }
        if (input.method === 'POST' && endpoint === 'patients' && !(input.queryString ?? '')) {
          const request = body(input);
          if (!request || !hasOnly(request, ['fullName', 'phone', 'ageYears', 'sex'], ['email', 'contactPatientId'])) {
            return result(400, { error: 'Invalid patient' });
          }
          const fullName = cleanName(request.fullName);
          const number = phone(request.phone);
          const patientEmail = email(request.email);
          if (!fullName || !number || patientEmail === undefined ||
              !Number.isInteger(request.ageYears) || typeof request.ageYears !== 'number' ||
              request.ageYears < 0 || request.ageYears > 130 || !SEXES.has(request.sex as Sex) ||
              (request.contactPatientId !== undefined && request.contactPatientId !== null &&
                (typeof request.contactPatientId !== 'string' || !ID.test(request.contactPatientId)))) {
            return result(400, { error: 'Invalid patient' });
          }
          // This is a shared-contact reference only. It grants no guardianship rights and does not copy email.
          const contactPatientId = request.contactPatientId as string | null | undefined;
          const contact = contactPatientId ? await store.getPatient(clinicSlug, contactPatientId) : null;
          if (contactPatientId && (!contact || phone(contact.phone)?.digits !== number.digits)) {
            return result(400, { error: 'Invalid patient' });
          }
          const patient: Patient = {
            id: randomUUID(), fullName, phone: number.display, ageYears: request.ageYears,
            sex: request.sex as Sex, email: patientEmail, contactPatientId: contact?.id ?? null,
            registeredAt: now().toISOString(),
          };
          await store.createPatient(clinicSlug, patient, nameIndex(fullName), number.digits, session.sub,
            contact ? { id: contact.id, phone: contact.phone } : null);
          return result(201, { patient: publicPatient(patient) });
        }
        if (input.method === 'GET' && endpoint === 'appointments') {
          const date = singleQuery(input.queryString, 'date');
          if (!date || !calendarDate(date)) return result(400, { error: 'Invalid date' });
          const appointments = await store.listAppointments(clinicSlug, date);
          return result(200, { items: appointments.map(publicAppointment) });
        }
        if (input.method === 'POST' && endpoint === 'appointments' && !(input.queryString ?? '')) {
          const request = body(input);
          if (!request || !hasOnly(request, ['patientId', 'doctorId', 'startAt', 'source']) ||
              typeof request.patientId !== 'string' || !ID.test(request.patientId) ||
              typeof request.doctorId !== 'string' || !ID.test(request.doctorId) ||
              !SOURCE.has(request.source as Source)) return result(400, { error: 'Invalid appointment' });
          const schedule = await store.getSchedule(clinicSlug);
          if (!schedule) return result(503, { error: 'Clinic schedule unavailable' });
          const start = startTime(request.startAt, schedule);
          if (!start) return result(400, { error: 'Invalid clinic slot' });
          if (Date.parse(start.startUtc) + 30 * 60 * 1000 <= now().getTime()) {
            return result(400, { error: 'Slot has already ended' });
          }
          const [patient, doctor] = await Promise.all([
            store.getPatient(clinicSlug, request.patientId), store.getDoctor(clinicSlug, request.doctorId),
          ]);
          if (!patient || !doctor?.active) return result(400, { error: 'Patient or doctor unavailable' });
          const appointment: Appointment = {
            id: randomUUID(), patientId: patient.id, patientName: patient.fullName,
            doctorId: doctor.id, doctorName: doctor.displayName,
            ...start, source: request.source as Source,
            status: request.source === 'walk_in' ? 'checked_in' : 'booked',
            createdAt: now().toISOString(), createdBySub: session.sub,
          };
          const booked = await store.createAppointment(clinicSlug, appointment);
          return booked ? result(201, { appointment: publicAppointment(appointment) }) : result(409, { error: 'Doctor slot already booked' });
        }
        if (input.method === 'GET' && endpoint === 'consultations/prescriptions') {
          const date = singleQuery(input.queryString, 'date');
          if (!date || !calendarDate(date)) return result(400, { error: 'Invalid date' });
          const [appointments, statuses] = await Promise.all([
            store.listAppointments(clinicSlug, date), store.listEncounterStatuses(clinicSlug, date),
          ]);
          const finalized = appointments.filter((appointment) => statuses.get(appointment.id) === 'finalized');
          const items = [];
          // The clinic-date partition is capped at 200 appointments; limit concurrent canonical reads.
          for (let offset = 0; offset < finalized.length; offset += 20) {
            const batch = finalized.slice(offset, offset + 20);
            const encounters = await Promise.all(batch.map((appointment) =>
              store.getEncounter(clinicSlug, date, appointment.id)));
            for (let index = 0; index < batch.length; index += 1) {
              const appointment = batch[index];
              const encounter = encounters[index];
              if (!finalizedPrescriptionMatches(encounter, appointment)) throw new Error('Invalid finalized prescription');
              if (encounter.medications.length === 0) continue;
              items.push({ appointmentId: appointment.id, clinicDate: appointment.clinicDate,
                patientId: appointment.patientId, patientName: appointment.patientName,
                doctorId: encounter.finalizedDoctorId, doctorName: encounter.finalizedByDisplayName,
                startAt: appointment.startAt, finalizedAt: encounter.finalizedAt });
            }
          }
          return result(200, { items });
        }
        if (input.method === 'POST' && endpoint === 'consultations/prescriptions/read' && !(input.queryString ?? '')) {
          const request = body(input, 2048);
          if (!request || !hasOnly(request, ['appointmentId', 'clinicDate']) ||
              typeof request.appointmentId !== 'string' || !ID.test(request.appointmentId) ||
              typeof request.clinicDate !== 'string' || !calendarDate(request.clinicDate)) {
            return result(400, { error: 'Invalid prescription request' });
          }
          const found = await resolveFinalizedPrescription(store, clinicSlug, request.appointmentId, request.clinicDate);
          return found ? result(200, { status: 'finalized',
            printablePrescription: printablePrescription(found.encounter, clinic, found.patient) }) :
            result(404, { error: 'Prescription not found' });
        }
        if (input.method === 'POST' && isPrescriptionEmail && !(input.queryString ?? '')) {
          const preview = endpoint.endsWith('/preview');
          const request = body(input, 2048);
          if (!request || !hasOnly(request, ['appointmentId', 'clinicDate',
            ...(preview ? [] : ['confirmPatientEmail', 'expectedRecipientEmail'])]) ||
              typeof request.appointmentId !== 'string' || !ID.test(request.appointmentId) ||
              typeof request.clinicDate !== 'string' || !calendarDate(request.clinicDate) ||
              (!preview && (request.confirmPatientEmail !== true ||
                typeof request.expectedRecipientEmail !== 'string' ||
                email(request.expectedRecipientEmail) !== request.expectedRecipientEmail))) {
            return result(400, { error: 'Invalid prescription email request' });
          }
          if (!config.prescriptionEmail) return result(503, { error: 'Demo prescription email unavailable' });
          const found = await resolveFinalizedPrescription(store, clinicSlug, request.appointmentId, request.clinicDate);
          if (!found) return result(404, { error: 'Prescription not found' });
          const recipient = email(found.patient.email);
          if (!recipient) return result(409, { error: 'Patient email unavailable' });
          if (!preview && request.expectedRecipientEmail !== recipient) {
            return result(409, { error: 'Patient email changed; review again' });
          }
          if (recipient !== config.prescriptionEmail.allowedRecipient) {
            return result(409, { error: 'Demo email is limited to the configured test recipient' });
          }
          const recipientMasked = maskEmail(recipient);
          if (preview) return result(200, { status: 'ready', recipientEmail: recipient, recipientMasked });
          const prescription = printablePrescription(found.encounter, clinic, found.patient);
          if (!prescription) return result(404, { error: 'Prescription not found' });
          let pdf: Uint8Array;
          try { pdf = await renderPrescriptionPdf(prescription); }
          catch (error) {
            if (error instanceof UnsupportedPrescriptionText) {
              return result(422, { error: 'Prescription cannot be rendered for demo email' });
            }
            throw error;
          }
          const recipientHash = createHash('sha256').update(recipient).digest('hex');
          const claimed = await store.claimPrescriptionEmail(clinicSlug, found.appointment.id,
            found.encounter.revision, recipientHash, session.sub, now().toISOString(), {
              clinicDate: found.appointment.clinicDate, patientId: found.patient.id,
              doctorId: found.appointment.doctorId, storedEmail: found.patient.email!,
            });
          if (claimed === 'stored_email_changed') return result(409, { error: 'Patient email changed; review again' });
          if (claimed === 'recipient_changed') return result(409, { error: 'Prescription email already requested' });
          if (claimed === 'accepted') return result(200, { status: 'accepted', recipientMasked });
          if (claimed === 'pending') return result(202, { status: 'pending', recipientMasked });
          if (claimed === 'unknown') return result(409, { status: 'unknown', recipientMasked });
          let stage: 'ses_send' | 'record_acceptance' = 'ses_send';
          let acceptedMessageId: string | undefined;
          try {
            const messageId = await config.prescriptionEmail.send(recipient, pdf);
            if (!messageId || messageId.length > 256) throw new Error('Invalid SES acceptance');
            acceptedMessageId = messageId;
            stage = 'record_acceptance';
            await store.markPrescriptionEmail(clinicSlug, found.appointment.id,
              found.encounter.revision, 'accepted', now().toISOString(), messageId);
            return result(202, { status: 'accepted', recipientMasked });
          } catch (error) {
            // Log only the failure stage and AWS request metadata; never log patient details or PDF bytes.
            console.error('prescription_email_outcome_unknown', {
              stage, ...emailFailureMetadata(error),
              ...(acceptedMessageId ? { messageId: acceptedMessageId } : {}),
            });
            // SES acceptance may be ambiguous after a timeout. Never automatically send again.
            try { await store.markPrescriptionEmail(clinicSlug, found.appointment.id,
              found.encounter.revision, 'unknown', now().toISOString()); }
            catch (recordError) {
              console.error('prescription_email_record_unknown_failed', emailFailureMetadata(recordError));
              // The claim remains pending until manually reconciled.
            }
            return result(503, { error: 'Demo email outcome unknown; do not resend automatically' });
          }
        }
        if (input.method === 'GET' && endpoint === 'consultations') {
          const date = singleQuery(input.queryString, 'date');
          if (!date || !calendarDate(date)) return result(400, { error: 'Invalid date' });
          const appointments = await store.listAppointments(clinicSlug, date);
          let visible = appointments;
          if (member.role === 'doctor') {
            const assigned = new Set((await store.listDoctors(clinicSlug))
              .filter((doctor) => doctor.active && doctor.staffSub === member.sub).map((doctor) => doctor.id));
            visible = appointments.filter((appointment) => assigned.has(appointment.doctorId));
          }
          const statuses = await store.listEncounterStatuses(clinicSlug, date);
          return result(200, { items: visible.map((appointment) => ({
            appointmentId: appointment.id, clinicDate: appointment.clinicDate,
            patientId: appointment.patientId, patientName: appointment.patientName,
            doctorId: appointment.doctorId, doctorName: appointment.doctorName,
            startAt: appointment.startAt, appointmentStatus: appointment.status,
            encounterStatus: statuses.get(appointment.id) ?? 'draft',
          })) });
        }
        if (input.method === 'POST' && endpoint.startsWith('consultations/history/') && !(input.queryString ?? '')) {
          const request = body(input, 2048);
          const listing = endpoint === 'consultations/history/list';
          if (!request || !hasOnly(request, ['appointmentId', 'clinicDate',
            ...(listing ? [] : ['historyId'])], listing ? ['cursor'] : []) ||
              typeof request.appointmentId !== 'string' || !ID.test(request.appointmentId) ||
              typeof request.clinicDate !== 'string' || !calendarDate(request.clinicDate) ||
              (!listing && !validHistoryId(request.historyId))) {
            return result(400, { error: 'Invalid patient history request' });
          }
          const appointments = await store.listAppointments(clinicSlug, request.clinicDate);
          const appointment = appointments.find((row) => row.id === request.appointmentId &&
            row.clinicDate === request.clinicDate);
          if (!appointment) return result(404, { error: 'Appointment not found' });
          const [patient, doctor, currentEncounter] = await Promise.all([
            store.getPatient(clinicSlug, appointment.patientId), store.getDoctor(clinicSlug, appointment.doctorId),
            store.getEncounter(clinicSlug, appointment.clinicDate, appointment.id),
          ]);
          if (!patient || patient.id !== appointment.patientId || !doctor || doctor.id !== appointment.doctorId) {
            return result(503, { error: 'Clinic record unavailable' });
          }
          if (!doctor.active || !doctor.staffSub || doctor.staffSub !== member.sub) {
            return result(403, { error: 'Doctor assignment denied' });
          }
          if (currentEncounter && (currentEncounter.appointmentId !== appointment.id ||
              currentEncounter.clinicDate !== appointment.clinicDate ||
              currentEncounter.patientId !== patient.id || currentEncounter.doctorId !== doctor.id)) {
            return result(503, { error: 'Clinic record unavailable' });
          }
          if (currentEncounter?.status === 'finalized' && currentEncounter.finalizedBySub !== member.sub) {
            return result(403, { error: 'Doctor assignment denied' });
          }
          // The selected appointment, never a browser-supplied patient ID, defines the history partition.
          historyIdFor(appointment.startUtc, appointment.id);
          const cutoff = `VISIT#${appointment.startUtc}`;
          const cursorContext = { clinicSlug, patientId: patient.id, appointmentId: appointment.id, cutoff };
          if (listing) {
            const before = request.cursor === undefined ? cutoff :
              decodeHistoryCursor(request.cursor, config.edgeKey, cursorContext, Math.floor(now().getTime() / 1000));
            if (!before) return result(400, { error: 'Invalid history cursor' });
            const rows = await store.listPatientHistory(clinicSlug, patient.id, before, 11);
            if (rows.some((entry) => entry.clinicSlug !== clinicSlug || entry.patientId !== patient.id ||
                entry.status !== 'finalized' || entry.historyId >= before || entry.historyId >= cutoff ||
                entry.appointmentId === appointment.id)) throw new Error('Invalid history index');
            const canonical = await Promise.all(rows.map((entry) =>
              store.getEncounter(clinicSlug, entry.clinicDate, entry.appointmentId)));
            if (rows.some((entry, index) => !historyMatchesEncounter(entry, canonical[index]))) {
              throw new Error('History index mismatch');
            }
            const items = rows.slice(0, 10);
            const nextCursor = rows.length > 10 ? encodeHistoryCursor({ v: 1, ...cursorContext,
              before: items[items.length - 1].historyId, expiresAt: Math.floor(now().getTime() / 1000) + 900 },
            config.edgeKey) : null;
            return result(200, { items: items.map(historySummary), nextCursor,
              coverage: 'indexed_finalizations_only' });
          }
          const historyId = request.historyId as string;
          if (historyId >= cutoff) return result(404, { error: 'History not found' });
          const entry = await store.getHistoryEntry(clinicSlug, patient.id, historyId);
          if (!entry || entry.clinicSlug !== clinicSlug || entry.patientId !== patient.id ||
              entry.historyId !== historyId || entry.status !== 'finalized' ||
              entry.appointmentId === appointment.id || entry.historyId >= cutoff) {
            return result(404, { error: 'History not found' });
          }
          const historical = await store.getEncounter(clinicSlug, entry.clinicDate, entry.appointmentId);
          if (!historical || historical.status !== 'finalized' || historical.patientId !== patient.id ||
              historical.appointmentId !== entry.appointmentId || historical.clinicDate !== entry.clinicDate) {
            return result(404, { error: 'History not found' });
          }
          if (!historyMatchesEncounter(entry, historical)) {
            throw new Error('History index mismatch');
          }
          return result(200, { history: { ...historySummary(entry), vitals: historical.vitals,
            note: historical.note, medications: historical.medications.map(medicationForDisplay) } });
        }
        if (input.method === 'POST' && endpoint.startsWith('consultations/') && !(input.queryString ?? '')) {
          const request = body(input, endpoint === 'consultations/draft' ? 18_000 : 4096);
          const action = endpoint.split('/')[1];
          const fields = ['appointmentId', 'clinicDate'];
          const required = action === 'read' ? fields : [...fields, 'expectedRevision',
            ...(action === 'vitals' ? ['vitals'] : action === 'draft' ? ['note', 'medications'] : [])];
          if (!request || !hasOnly(request, required) ||
              typeof request.appointmentId !== 'string' || !ID.test(request.appointmentId) ||
              typeof request.clinicDate !== 'string' || !calendarDate(request.clinicDate)) {
            return result(400, { error: 'Invalid consultation request' });
          }
          const appointments = await store.listAppointments(clinicSlug, request.clinicDate);
          const appointment = appointments.find((row) => row.id === request.appointmentId && row.clinicDate === request.clinicDate);
          if (!appointment) return result(404, { error: 'Appointment not found' });
          const [patient, doctor, stored] = await Promise.all([
            store.getPatient(clinicSlug, appointment.patientId),
            store.getDoctor(clinicSlug, appointment.doctorId),
            store.getEncounter(clinicSlug, request.clinicDate, appointment.id),
          ]);
          if (!patient || patient.id !== appointment.patientId || !doctor || doctor.id !== appointment.doctorId) {
            return result(503, { error: 'Clinic record unavailable' });
          }
          if (member.role === 'doctor' && (!doctor.active || !doctor.staffSub || doctor.staffSub !== member.sub)) {
            return result(403, { error: 'Doctor assignment denied' });
          }
          if (stored && (stored.appointmentId !== appointment.id || stored.clinicDate !== request.clinicDate ||
              stored.patientId !== patient.id || stored.doctorId !== doctor.id)) {
            return result(503, { error: 'Clinic record unavailable' });
          }
          if (member.role === 'doctor' && stored?.status === 'finalized' && stored.finalizedBySub !== member.sub) {
            return result(403, { error: 'Doctor assignment denied' });
          }
          const current: Encounter = stored ?? {
            appointmentId: appointment.id, clinicDate: request.clinicDate,
            patientId: patient.id, doctorId: doctor.id, status: 'draft', revision: 0,
            vitals: null, note: { ...EMPTY_NOTE }, medications: [], noteAuthorSub: null,
            updatedAt: null, finalizedAt: null, finalizedBySub: null,
            finalizedByDisplayName: null, finalizedDoctorId: null,
          };
          if (action === 'read') return result(200, consultationResponse(current, clinic, patient, doctor, member.role));
          if (typeof request.expectedRevision !== 'number' || !Number.isSafeInteger(request.expectedRevision) ||
              request.expectedRevision < 0 || request.expectedRevision > 1_000_000) {
            return result(400, { error: 'Invalid revision' });
          }
          if (current.revision !== request.expectedRevision || current.status === 'finalized') {
            return result(409, { error: 'Encounter changed or finalized' });
          }
          const timestamp = now();
          let next: Encounter;
          let auditAction: 'vitals.saved' | 'draft.saved' | 'encounter.finalized';
          if (action === 'vitals') {
            const vitals = parseVitals(request.vitals, timestamp, session.sub, member.displayName ?? member.username);
            if (!vitals) return result(400, { error: 'Invalid vitals' });
            next = { ...current, vitals, revision: current.revision + 1, updatedAt: timestamp.toISOString() };
            auditAction = 'vitals.saved';
          } else if (action === 'draft') {
            const note = parseNote(request.note);
            const medications = parseMedications(request.medications, session.sub, appointment.id, timestamp);
            if (!note || !medications) return result(400, { error: 'Invalid consultation draft' });
            next = { ...current, note, medications, noteAuthorSub: session.sub,
              revision: current.revision + 1, updatedAt: timestamp.toISOString() };
            auditAction = 'draft.saved';
          } else if (action === 'finalize') {
            if (!stored || current.noteAuthorSub !== session.sub || !readyToFinalize(current)) {
              return result(400, { error: 'Draft is incomplete' });
            }
            if (!member.displayName?.trim() || member.displayName.length > 160) {
              return result(503, { error: 'Clinician identity unavailable' });
            }
            next = { ...current, status: 'finalized', revision: current.revision + 1,
              finalizedAt: timestamp.toISOString(), updatedAt: timestamp.toISOString(),
              finalizedBySub: session.sub, finalizedByDisplayName: member.displayName,
              finalizedDoctorId: appointment.doctorId };
            auditAction = 'encounter.finalized';
          } else {
            return result(404, { error: 'Not found' });
          }
          const saved = await store.saveEncounter(clinicSlug, appointment, next, request.expectedRevision,
            session.sub, auditAction, member.role === 'doctor' ? session.sub : undefined);
          return saved ? result(200, consultationResponse(next, clinic, patient, doctor, member.role)) :
            result(409, { error: 'Encounter changed or finalized' });
        }
        return result(404, { error: 'Not found' });
      } catch {
        // Never serialize database exceptions, cookies, tokens, or patient details.
        return result(503, { error: 'Clinic workflow temporarily unavailable' });
      }
    },
  };
}
