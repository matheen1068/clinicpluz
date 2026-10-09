import { validClinicSlug } from './tenant.ts';

export type EncounterStatus = 'draft' | 'finalized';
export interface ConsultationQueueItem {
  appointmentId: string;
  clinicDate: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  startAt: string;
  appointmentStatus: string;
  encounterStatus: EncounterStatus;
}
export interface VitalsInput {
  observedAt: string;
  systolicBpMmHg?: number;
  diastolicBpMmHg?: number;
  pulseBpm?: number;
  spo2Percent?: number;
  temperatureC?: number;
  weightKg?: number;
  heightCm?: number;
}
export interface Vitals extends VitalsInput {
  recordedAt: string;
  recordedBySub: string;
  recordedByDisplayName: string;
}
export interface ConsultationNote {
  chiefComplaint: string;
  history: string;
  exam: string;
  assessment: string;
  plan: string;
}
export interface Medication {
  name: string;
  strength: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
}
export interface MedicineCatalogItem { id: string; name: string; strength: string; favorite: boolean }
export interface PersonIdentity { id: string; fullName: string; ageYears: number; sex: string }
export interface DoctorIdentity { id: string; displayName: string }
export interface ClinicIdentity { slug: string; displayName: string }
export interface PrintablePrescription {
  clinic: ClinicIdentity;
  patient: PersonIdentity;
  doctor: DoctorIdentity;
  appointmentDate: string;
  finalizedAt: string;
  medications: Medication[];
}
export interface Encounter {
  appointmentId: string;
  clinicDate: string;
  status: EncounterStatus;
  revision: number;
  vitals: Vitals | null;
  note?: ConsultationNote;
  medications?: Medication[];
  finalizedAt: string | null;
  patient: PersonIdentity;
  doctor: DoctorIdentity;
  clinic: ClinicIdentity;
  printablePrescription?: PrintablePrescription;
}

export class ConsultationApiError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) {
    super(message);
    this.name = 'ConsultationApiError';
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);

function path(slug: string, endpoint: string): string {
  if (!validClinicSlug(slug) || !/^(?:consultations|consultations\/(?:read|vitals|draft|finalize|medicines\/search))(?:\?date=\d{4}-\d{2}-\d{2})?$/.test(endpoint)) {
    throw new ConsultationApiError(null, 'Invalid consultation route');
  }
  return `/api/workflow/clinics/${slug}/${endpoint}`;
}
function csrfHeaders(csrfToken: string): HeadersInit {
  if (!nonempty(csrfToken)) throw new ConsultationApiError(null, 'Missing authenticated CSRF token');
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
}
async function request(endpoint: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...init, credentials: 'include', cache: 'no-store', mode: 'same-origin', redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ConsultationApiError(null, 'Consultation service unavailable');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const fromApi = contentType === 'application/json' || contentType?.endsWith('+json');
  if (!response.ok) throw new ConsultationApiError(fromApi ? response.status : null, 'Consultation request failed');
  if (!fromApi) throw new ConsultationApiError(null, 'Invalid consultation response');
  try { return await response.json(); }
  catch { throw new ConsultationApiError(null, 'Invalid consultation response'); }
}

function stringFields(value: unknown, fields: readonly string[]): value is Record<string, string> {
  return isRecord(value) && fields.every((field) => typeof value[field] === 'string');
}
const NOTE_FIELDS = ['chiefComplaint', 'history', 'exam', 'assessment', 'plan'] as const;
const MEDICATION_FIELDS = ['name', 'strength', 'dose', 'route', 'frequency', 'duration', 'instructions'] as const;
function parseNote(value: unknown): ConsultationNote {
  if (!stringFields(value, NOTE_FIELDS)) throw new ConsultationApiError(null, 'Invalid consultation note response');
  return value as unknown as ConsultationNote;
}
function parseMedication(value: unknown): Medication {
  if (!stringFields(value, MEDICATION_FIELDS)) throw new ConsultationApiError(null, 'Invalid medication response');
  return value as unknown as Medication;
}
function parsePatient(value: unknown): PersonIdentity {
  if (!isRecord(value) || !nonempty(value.id) || !nonempty(value.fullName) ||
      typeof value.ageYears !== 'number' || !Number.isInteger(value.ageYears) || !nonempty(value.sex)) {
    throw new ConsultationApiError(null, 'Invalid patient response');
  }
  return value as unknown as PersonIdentity;
}
function parseDoctor(value: unknown): DoctorIdentity {
  if (!isRecord(value) || !nonempty(value.id) || !nonempty(value.displayName)) throw new ConsultationApiError(null, 'Invalid doctor response');
  return value as unknown as DoctorIdentity;
}
function parseClinic(value: unknown): ClinicIdentity {
  if (!isRecord(value) || !nonempty(value.slug) || !nonempty(value.displayName)) throw new ConsultationApiError(null, 'Invalid clinic response');
  return value as unknown as ClinicIdentity;
}
function parseVitals(value: unknown): Vitals | null {
  if (value === null) return null;
  if (!isRecord(value) || !validTime(value.observedAt) || !validTime(value.recordedAt) ||
      !nonempty(value.recordedBySub) || !nonempty(value.recordedByDisplayName)) {
    throw new ConsultationApiError(null, 'Invalid vitals response');
  }
  for (const field of ['systolicBpMmHg', 'diastolicBpMmHg', 'pulseBpm', 'spo2Percent', 'temperatureC', 'weightKg', 'heightCm']) {
    if (value[field] !== undefined && (typeof value[field] !== 'number' || !Number.isFinite(value[field]))) {
      throw new ConsultationApiError(null, 'Invalid vitals response');
    }
  }
  return value as unknown as Vitals;
}
function parsePrintable(value: unknown): PrintablePrescription {
  if (!isRecord(value) || !validDate(value.appointmentDate) || !validTime(value.finalizedAt) ||
      !Array.isArray(value.medications) || value.medications.length === 0) {
    throw new ConsultationApiError(null, 'Invalid prescription response');
  }
  return {
    clinic: parseClinic(value.clinic), patient: parsePatient(value.patient), doctor: parseDoctor(value.doctor),
    appointmentDate: value.appointmentDate, finalizedAt: value.finalizedAt, medications: value.medications.map(parseMedication),
  };
}
function parseEncounter(value: unknown, slug: string, appointmentId: string, clinicDate: string, printValue: unknown): Encounter {
  if (!isRecord(value) || value.appointmentId !== appointmentId || value.clinicDate !== clinicDate ||
      (value.status !== 'draft' && value.status !== 'finalized') ||
      typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0 ||
      (value.finalizedAt !== null && !validTime(value.finalizedAt))) {
    throw new ConsultationApiError(null, 'Invalid encounter response');
  }
  const clinic = parseClinic(value.clinic);
  if (clinic.slug !== slug) throw new ConsultationApiError(null, 'Clinic response mismatch');
  const note = value.note === undefined ? undefined : parseNote(value.note);
  const medications = value.medications === undefined ? undefined : Array.isArray(value.medications) ? value.medications.map(parseMedication) : null;
  if (medications === null) throw new ConsultationApiError(null, 'Invalid medications response');
  const printable = printValue === undefined ? undefined : parsePrintable(printValue);
  const patient = parsePatient(value.patient);
  const doctor = parseDoctor(value.doctor);
  if (printable && (printable.clinic.slug !== clinic.slug || printable.patient.id !== patient.id ||
      printable.doctor.id !== doctor.id || printable.appointmentDate !== clinicDate ||
      printable.finalizedAt !== value.finalizedAt || printable.clinic.displayName !== clinic.displayName ||
      printable.patient.fullName !== patient.fullName || printable.patient.ageYears !== patient.ageYears ||
      printable.patient.sex !== patient.sex || printable.doctor.displayName !== doctor.displayName ||
      !medications || printable.medications.length !== medications.length ||
      printable.medications.some((item, index) => MEDICATION_FIELDS.some((field) => item[field] !== medications[index][field])))) {
    throw new ConsultationApiError(null, 'Prescription identity mismatch');
  }
  if ((value.status === 'draft' && (value.finalizedAt !== null || printable)) ||
      (value.status === 'finalized' && !validTime(value.finalizedAt))) {
    throw new ConsultationApiError(null, 'Invalid encounter status');
  }
  return {
    appointmentId, clinicDate, status: value.status, revision: value.revision,
    vitals: parseVitals(value.vitals), finalizedAt: value.finalizedAt,
    patient, doctor, clinic,
    ...(note ? { note } : {}), ...(medications ? { medications } : {}),
    ...(printable ? { printablePrescription: printable } : {}),
  };
}
function parseQueue(value: unknown): ConsultationQueueItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new ConsultationApiError(null, 'Invalid consultation queue response');
  return value.items.map((item: unknown) => {
    if (!isRecord(item) || !validId(item.appointmentId) || !validDate(item.clinicDate) ||
        !validId(item.patientId) || !nonempty(item.patientName) || !validId(item.doctorId) ||
        !nonempty(item.doctorName) || !validTime(item.startAt) || !nonempty(item.appointmentStatus) ||
        !['draft', 'finalized'].includes(item.encounterStatus as string)) {
      throw new ConsultationApiError(null, 'Invalid consultation queue item');
    }
    return item as unknown as ConsultationQueueItem;
  });
}
function parseEncounterResponse(value: unknown, slug: string, appointmentId: string, clinicDate: string): Encounter {
  if (!isRecord(value)) throw new ConsultationApiError(null, 'Invalid consultation response');
  return parseEncounter(value.encounter, slug, appointmentId, clinicDate, value.printablePrescription);
}

export async function getConsultationQueue(slug: string, date: string, signal?: AbortSignal): Promise<ConsultationQueueItem[]> {
  if (!validDate(date)) throw new ConsultationApiError(null, 'Invalid queue date');
  const items = parseQueue(await request(path(slug, `consultations?date=${date}`), { method: 'GET', signal }));
  if (items.some((item) => item.clinicDate !== date)) throw new ConsultationApiError(null, 'Consultation queue date mismatch');
  return items;
}
export async function searchMedicines(slug: string, query: string, csrfToken: string, signal?: AbortSignal): Promise<MedicineCatalogItem[]> {
  const term = query.trim().replace(/\s+/g, ' ');
  if (term.length < 2 || term.length > 64 || !/^[\p{L}\p{M}\p{N} .'-]+$/u.test(term)) {
    throw new ConsultationApiError(null, 'Enter at least two letters or numbers to search medicines');
  }
  const response = await request(path(slug, 'consultations/medicines/search'), {
    method: 'POST', headers: csrfHeaders(csrfToken), body: JSON.stringify({ query: term }), signal,
  });
  if (!isRecord(response) || !Array.isArray(response.items) || response.items.length > 20) {
    throw new ConsultationApiError(null, 'Invalid medicine catalog response');
  }
  return response.items.map((value: unknown) => {
    if (!isRecord(value) || !validId(value.id) || !nonempty(value.name) || value.name.length > 160 ||
        !nonempty(value.strength) || value.strength.length > 160 || typeof value.favorite !== 'boolean') {
      throw new ConsultationApiError(null, 'Invalid medicine catalog item');
    }
    return value as unknown as MedicineCatalogItem;
  });
}
export async function readEncounter(slug: string, appointmentId: string, clinicDate: string, csrfToken: string, signal?: AbortSignal): Promise<Encounter> {
  if (!validId(appointmentId) || !validDate(clinicDate)) throw new ConsultationApiError(null, 'Invalid appointment selection');
  return parseEncounterResponse(await request(path(slug, 'consultations/read'), {
    method: 'POST', headers: csrfHeaders(csrfToken), body: JSON.stringify({ appointmentId, clinicDate }), signal,
  }), slug, appointmentId, clinicDate);
}
export async function saveVitals(slug: string, appointmentId: string, clinicDate: string, expectedRevision: number, vitals: VitalsInput, csrfToken: string): Promise<Encounter> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || !validDate(clinicDate) || !validId(appointmentId)) throw new ConsultationApiError(null, 'Invalid vitals request');
  return parseEncounterResponse(await request(path(slug, 'consultations/vitals'), {
    method: 'POST', headers: csrfHeaders(csrfToken), body: JSON.stringify({ appointmentId, clinicDate, expectedRevision, vitals }),
  }), slug, appointmentId, clinicDate);
}
export async function saveDraft(slug: string, appointmentId: string, clinicDate: string, expectedRevision: number, note: ConsultationNote, medications: Medication[], csrfToken: string): Promise<Encounter> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || !validDate(clinicDate) || !validId(appointmentId)) throw new ConsultationApiError(null, 'Invalid draft request');
  const body = JSON.stringify({ appointmentId, clinicDate, expectedRevision, note, medications });
  if (body.length > 18_000) throw new ConsultationApiError(400, 'Draft is too long');
  return parseEncounterResponse(await request(path(slug, 'consultations/draft'), {
    method: 'POST', headers: csrfHeaders(csrfToken), body,
  }), slug, appointmentId, clinicDate);
}
export async function finalizeEncounter(slug: string, appointmentId: string, clinicDate: string, expectedRevision: number, csrfToken: string): Promise<Encounter> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || !validDate(clinicDate) || !validId(appointmentId)) throw new ConsultationApiError(null, 'Save a draft before finalizing');
  return parseEncounterResponse(await request(path(slug, 'consultations/finalize'), {
    method: 'POST', headers: csrfHeaders(csrfToken), body: JSON.stringify({ appointmentId, clinicDate, expectedRevision }),
  }), slug, appointmentId, clinicDate);
}
