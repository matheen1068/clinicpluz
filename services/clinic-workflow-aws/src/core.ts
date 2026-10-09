import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { EMPTY_NOTE, medicationForDisplay, parseMedications, parseNote, parseVitals, readyToFinalize,
  type Encounter } from './consultation.ts';

export type Role = 'clinic_admin' | 'doctor' | 'receptionist' | 'nurse' | 'lab_tech' | 'billing';
export type Sex = 'female' | 'male' | 'other' | 'undisclosed';
export type Source = 'phone' | 'walk_in';
export type AppointmentStatus = 'booked' | 'checked_in';
export interface Session { clinicSlug: string; username: string; sub: string; csrfToken: string; expiresAt: number }
export interface Clinic { slug: string; active: boolean; displayName?: string }
export interface Membership { clinicSlug: string; username: string; cognitoUsername: string; sub: string; role: Role; active: boolean; displayName?: string }
export interface Entitlements { clinicSlug: string; patient_intake: boolean; appointments: boolean; consultations: boolean }
export interface Doctor { id: string; displayName: string; active: boolean; staffSub?: string }
export interface MedicineCatalogItem { id: string; name: string; strength: string; active: boolean; favorite: boolean }
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
  listMedicines(slug: string): Promise<MedicineCatalogItem[]>;
  getDoctor(slug: string, id: string): Promise<Doctor | null>;
  searchPatients(slug: string, kind: 'name' | 'phone', prefix: string): Promise<Patient[]>;
  getPatient(slug: string, id: string): Promise<Patient | null>;
  createPatient(slug: string, patient: Patient, nameKey: string, phoneKey: string, actorSub: string): Promise<void>;
  listAppointments(slug: string, clinicDate: string): Promise<Appointment[]>;
  createAppointment(slug: string, appointment: Appointment): Promise<boolean>;
  getEncounter(slug: string, clinicDate: string, appointmentId: string): Promise<Encounter | null>;
  listEncounterStatuses(slug: string, clinicDate: string): Promise<Map<string, 'draft' | 'finalized'>>;
  saveEncounter(slug: string, appointment: Appointment, encounter: Encounter,
    expectedRevision: number, actorSub: string, action: 'vitals.saved' | 'draft.saved' | 'encounter.finalized',
    assignedDoctorSub?: string): Promise<boolean>;
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
  const { id, fullName, phone, ageYears, sex, email } = patient;
  return { id, fullName, phone, ageYears, sex, email };
}
function publicAppointment(appointment: Appointment) {
  const { id, patientId, patientName, doctorId, doctorName, startAt, source, status } = appointment;
  return { id, patientId, patientName, doctorId, doctorName, startAt, source, status };
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
  const printablePrescription = encounter.status === 'finalized' && encounter.medications.length > 0 ? {
    clinic: { slug: clinic.slug, displayName: clinic.displayName ?? clinic.slug },
    doctor: shownDoctor,
    patient: { id: patient.id, fullName: patient.fullName, ageYears: patient.ageYears, sex: patient.sex },
    appointmentDate: encounter.clinicDate, finalizedAt: encounter.finalizedAt,
    medications: encounter.medications.map(medicationForDisplay),
  } : undefined;
  return printablePrescription ? { encounter: publicEncounter, printablePrescription } : { encounter: publicEncounter };
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
        const match = /^\/api\/workflow\/clinics\/([a-z0-9-]+)\/(doctors|patients(?:\/search)?|appointments|consultations(?:\/(?:read|vitals|draft|finalize|medicines\/search))?)$/.exec(input.path);
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
        const module = isConsultation ? 'consultations' : endpoint.startsWith('patients') ? 'patient_intake' : 'appointments';
        if (!modules || modules.clinicSlug !== clinicSlug || modules[module] !== true) return result(403, { error: 'Module unavailable' });
        if (isConsultation) {
          if (member.role !== 'nurse' && member.role !== 'doctor') return result(403, { error: 'Role not allowed' });
          if ((endpoint === 'consultations/draft' || endpoint === 'consultations/finalize' ||
              endpoint === 'consultations/medicines/search') && member.role !== 'doctor') {
            return result(403, { error: 'Role not allowed' });
          }
        } else {
          const viewing = input.method === 'GET' || endpoint === 'patients/search';
          if (!(viewing ? VIEW_ROLES : WRITE_ROLES).has(member.role)) return result(403, { error: 'Role not allowed' });
        }
        if (input.method === 'POST' && (input.headers.origin !== config.publicOrigin ||
            !safeEqual(input.headers['x-csrf-token'] ?? '', session.csrfToken))) return result(403, { error: 'CSRF rejected' });

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
            if (!member.displayName?.trim()) return result(503, { error: 'Clinician identity unavailable' });
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
