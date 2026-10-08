import { validClinicSlug } from './tenant.ts';

export type PatientSex = 'female' | 'male' | 'other' | 'undisclosed';
export type BookingSource = 'phone' | 'walk_in';

export interface Doctor { id: string; displayName: string }
export interface Patient {
  id: string;
  fullName: string;
  phone: string;
  ageYears: number;
  sex: PatientSex;
  email?: string;
}
export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  startAt: string;
  source: BookingSource;
  status: string;
}
export interface CreatedAppointment {
  id: string;
  patientId: string;
  doctorId: string;
  startAt: string;
  source: BookingSource;
  status: string;
}
export interface NewPatient {
  fullName: string;
  phone: string;
  ageYears: number;
  sex: PatientSex;
  email?: string;
}
export interface NewAppointment { patientId: string; doctorId: string; startAt: string; source: BookingSource }

export class WorkflowApiError extends Error {
  readonly status: number | null;

  constructor(status: number | null, message: string) {
    super(message);
    this.name = 'WorkflowApiError';
    this.status = status;
  }
}

const SEXES = new Set<PatientSex>(['female', 'male', 'other', 'undisclosed']);
const SOURCES = new Set<BookingSource>(['phone', 'walk_in']);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function workflowPath(slug: string, path: string): string {
  if (!validClinicSlug(slug) || !/^(doctors|patients|patients\/search|appointments)(?:\?.*)?$/.test(path)) {
    throw new WorkflowApiError(null, 'Invalid workflow route');
  }
  return `/api/workflow/clinics/${slug}/${path}`;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      mode: 'same-origin',
      redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new WorkflowApiError(null, 'Clinic workflow service is unavailable');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const jsonResponse = contentType === 'application/json' || contentType?.endsWith('+json');
  if (!response.ok) throw new WorkflowApiError(jsonResponse ? response.status : null, 'Clinic workflow request failed');
  if (!jsonResponse) throw new WorkflowApiError(null, 'Invalid workflow response');
  try { return await response.json(); }
  catch { throw new WorkflowApiError(null, 'Invalid workflow response'); }
}

function doctor(value: unknown): Doctor {
  if (!isRecord(value) || !nonempty(value.id) || !nonempty(value.displayName)) throw new WorkflowApiError(null, 'Invalid doctor response');
  return { id: value.id, displayName: value.displayName };
}
function patient(value: unknown): Patient {
  if (!isRecord(value) || !nonempty(value.id) || !nonempty(value.fullName) || !nonempty(value.phone) ||
      typeof value.ageYears !== 'number' || !Number.isInteger(value.ageYears) || value.ageYears < 0 || !SEXES.has(value.sex as PatientSex) ||
      (value.email !== undefined && value.email !== null && typeof value.email !== 'string')) {
    throw new WorkflowApiError(null, 'Invalid patient response');
  }
  return {
    id: value.id, fullName: value.fullName, phone: value.phone, ageYears: value.ageYears,
    sex: value.sex as PatientSex,
    ...(typeof value.email === 'string' && value.email ? { email: value.email } : {}),
  };
}
function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function appointment(value: unknown): Appointment {
  if (!isRecord(value) || !nonempty(value.id) || !nonempty(value.patientId) || !nonempty(value.patientName) ||
      !nonempty(value.doctorId) || !nonempty(value.doctorName) || !validTimestamp(value.startAt) ||
      !SOURCES.has(value.source as BookingSource) || !nonempty(value.status)) {
    throw new WorkflowApiError(null, 'Invalid appointment response');
  }
  return value as unknown as Appointment;
}
function createdAppointment(value: unknown): CreatedAppointment {
  if (!isRecord(value) || !nonempty(value.id) || !nonempty(value.patientId) || !nonempty(value.doctorId) ||
      !validTimestamp(value.startAt) || !SOURCES.has(value.source as BookingSource) || !nonempty(value.status)) {
    throw new WorkflowApiError(null, 'Invalid booking response');
  }
  return value as unknown as CreatedAppointment;
}
function items(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new WorkflowApiError(null, 'Invalid workflow response');
  return value.items;
}
function mutationHeaders(csrfToken: string): HeadersInit {
  if (!nonempty(csrfToken)) throw new WorkflowApiError(null, 'Missing authenticated CSRF token');
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
}

export async function getDoctors(slug: string, signal?: AbortSignal): Promise<Doctor[]> {
  return items(await request(workflowPath(slug, 'doctors'), { signal })).map(doctor);
}
export async function searchPatients(slug: string, query: string, csrfToken: string, signal?: AbortSignal): Promise<Patient[]> {
  const q = query.trim();
  if (q.length < 2) throw new WorkflowApiError(null, 'Enter at least two search characters');
  return items(await request(workflowPath(slug, 'patients/search'), {
    method: 'POST', headers: mutationHeaders(csrfToken), body: JSON.stringify({ query: q }), signal,
  })).map(patient);
}
export async function registerPatient(slug: string, input: NewPatient, csrfToken: string): Promise<Patient> {
  const result = await request(workflowPath(slug, 'patients'), {
    method: 'POST', headers: mutationHeaders(csrfToken), body: JSON.stringify(input),
  });
  if (!isRecord(result)) throw new WorkflowApiError(null, 'Invalid patient response');
  return patient(result.patient);
}
export async function getAppointments(slug: string, date: string, signal?: AbortSignal): Promise<Appointment[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new WorkflowApiError(null, 'Invalid queue date');
  return items(await request(workflowPath(slug, `appointments?date=${date}`), { signal })).map(appointment);
}
export async function createAppointment(slug: string, input: NewAppointment, csrfToken: string): Promise<CreatedAppointment> {
  if (!nonempty(input.patientId) || !nonempty(input.doctorId) || !validTimestamp(input.startAt) || !SOURCES.has(input.source)) {
    throw new WorkflowApiError(null, 'Invalid booking details');
  }
  const result = await request(workflowPath(slug, 'appointments'), {
    method: 'POST', headers: mutationHeaders(csrfToken), body: JSON.stringify(input),
  });
  if (!isRecord(result)) throw new WorkflowApiError(null, 'Invalid booking response');
  return createdAppointment(result.appointment);
}

export function pilotDateToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (part: string) => parts.find((item) => item.type === part)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Provisional synthetic-pilot schedule. Replace with server-provided clinic settings before real use. */
export function pilotSlotToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:09:30|1[0-7]:(?:00|30)|18:00)$/.test(time)) return null;
  const local = new Date(`${date}T${time}:00+05:30`);
  if (!Number.isFinite(local.getTime())) return null;
  const back = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(local);
  const get = (part: string) => back.find((item) => item.type === part)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}` === date && `${get('hour')}:${get('minute')}` === time ? local.toISOString() : null;
}
