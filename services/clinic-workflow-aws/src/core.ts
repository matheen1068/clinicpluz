import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export type Role = 'clinic_admin' | 'doctor' | 'receptionist' | 'nurse' | 'lab_tech' | 'billing';
export type Sex = 'female' | 'male' | 'other' | 'undisclosed';
export type Source = 'phone' | 'walk_in';
export type AppointmentStatus = 'booked' | 'checked_in';
export interface Session { clinicSlug: string; username: string; sub: string; csrfToken: string; expiresAt: number }
export interface Clinic { slug: string; active: boolean }
export interface Membership { clinicSlug: string; username: string; cognitoUsername: string; sub: string; role: Role; active: boolean }
export interface Entitlements { clinicSlug: string; patient_intake: boolean; appointments: boolean }
export interface Doctor { id: string; displayName: string; active: boolean }
export interface Schedule { timezone: string; openMinute: number; closeMinute: number; slotMinutes: number }
export interface Patient {
  id: string; fullName: string; phone: string; ageYears: number; sex: Sex;
  email: string | null; registeredAt: string;
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
  getDoctor(slug: string, id: string): Promise<Doctor | null>;
  searchPatients(slug: string, kind: 'name' | 'phone', prefix: string): Promise<Patient[]>;
  getPatient(slug: string, id: string): Promise<Patient | null>;
  createPatient(slug: string, patient: Patient, nameKey: string, phoneKey: string, actorSub: string): Promise<void>;
  listAppointments(slug: string, clinicDate: string): Promise<Appointment[]>;
  createAppointment(slug: string, appointment: Appointment): Promise<boolean>;
}
export interface HttpInput {
  method: string; path: string; queryString?: string; headers: Record<string, string | undefined>;
  cookies?: string[]; body?: string; isBase64Encoded?: boolean;
}
export interface HttpResult { statusCode: number; headers: Record<string, string>; body: string }
export interface Config { publicOrigin: string; edgeKey: string; now?: () => Date }

const ROLES = new Set<Role>(['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing']);
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
function body(input: HttpInput): Record<string, unknown> | null {
  if (input.isBase64Encoded || !input.headers['content-type']?.toLowerCase().startsWith('application/json') ||
      !input.body || input.body.length > 4096) return null;
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
  const { id, fullName, phone, ageYears, sex, email } = patient;
  return { id, fullName, phone, ageYears, sex, email };
}
function publicAppointment(appointment: Appointment) {
  const { id, patientId, patientName, doctorId, doctorName, startAt, source, status } = appointment;
  return { id, patientId, patientName, doctorId, doctorName, startAt, source, status };
}

export function createWorkflowApp(auth: AuthStore, identity: StaffIdentity, store: WorkflowStore, config: Config) {
  const origin = new URL(config.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== config.publicOrigin ||
      !/^[a-z0-9-]+\.cloudfront\.net$/.test(origin.hostname) || config.edgeKey.length < 32) {
    throw new Error('Invalid staging workflow configuration');
  }
  const now = config.now ?? (() => new Date());

  return {
    async handle(input: HttpInput): Promise<HttpResult> {
      try {
        if (!safeEqual(input.headers['x-clinicpluz-edge-key'] ?? '', config.edgeKey)) return result(403, { error: 'Forbidden' });
        if (input.headers.origin && input.headers.origin !== config.publicOrigin) return result(403, { error: 'Origin rejected' });
        const match = /^\/api\/workflow\/clinics\/([a-z0-9-]+)\/(doctors|patients(?:\/search)?|appointments)$/.exec(input.path);
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
        const module = endpoint.startsWith('patients') ? 'patient_intake' : 'appointments';
        if (!modules || modules.clinicSlug !== clinicSlug || modules[module] !== true) return result(403, { error: 'Module unavailable' });
        const viewing = input.method === 'GET' || endpoint === 'patients/search';
        if (!(viewing ? VIEW_ROLES : WRITE_ROLES).has(member.role)) return result(403, { error: 'Role not allowed' });
        if (input.method === 'POST' && (input.headers.origin !== config.publicOrigin ||
            !safeEqual(input.headers['x-csrf-token'] ?? '', session.csrfToken))) return result(403, { error: 'CSRF rejected' });

        if (input.method === 'GET' && endpoint === 'doctors' && !(input.queryString ?? '')) {
          const doctors = await store.listDoctors(clinicSlug);
          return result(200, { items: doctors.filter((doctor) => doctor.active).map(({ id, displayName }) => ({ id, displayName })) });
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
          if (!request || !hasOnly(request, ['fullName', 'phone', 'ageYears', 'sex'], ['email'])) return result(400, { error: 'Invalid patient' });
          const fullName = cleanName(request.fullName);
          const number = phone(request.phone);
          const patientEmail = email(request.email);
          if (!fullName || !number || patientEmail === undefined ||
              !Number.isInteger(request.ageYears) || typeof request.ageYears !== 'number' ||
              request.ageYears < 0 || request.ageYears > 130 || !SEXES.has(request.sex as Sex)) {
            return result(400, { error: 'Invalid patient' });
          }
          const patient: Patient = {
            id: randomUUID(), fullName, phone: number.display, ageYears: request.ageYears,
            sex: request.sex as Sex, email: patientEmail, registeredAt: now().toISOString(),
          };
          await store.createPatient(clinicSlug, patient, nameIndex(fullName), number.digits, session.sub);
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
        return result(404, { error: 'Not found' });
      } catch {
        // Never serialize database exceptions, cookies, tokens, or patient details.
        return result(503, { error: 'Clinic workflow temporarily unavailable' });
      }
    },
  };
}
