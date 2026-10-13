import { ConsultationApiError, parseMedication, type ConsultationNote, type Medication, type Vitals } from './consultationApi.ts';
import { validClinicSlug } from './tenant.ts';

export interface HistoryContext {
  clinicSlug: string;
  appointmentId: string;
  clinicDate: string;
  patientId: string;
  currentVisitAt: string;
}
export interface HistoryVisit {
  historyId: string;
  clinicSlug: string;
  patientId: string;
  status: 'finalized';
  visitAt: string;
  finalizedAt: string;
  doctor: { id: string; displayName: string };
}
export interface HistoryDetail extends HistoryVisit {
  vitals: Vitals | null;
  note: ConsultationNote;
  medications: Medication[];
}
export interface HistoryPage { items: HistoryVisit[]; nextCursor: string | null }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const opaque = (value: unknown): value is string => nonempty(value) && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value);
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);

function ensureContext(context: HistoryContext, csrfToken: string) {
  if (!validClinicSlug(context.clinicSlug) || !validId(context.appointmentId) ||
      !validDate(context.clinicDate) || !validId(context.patientId) ||
      !validTime(context.currentVisitAt) || !nonempty(csrfToken)) {
    throw new ConsultationApiError(null, 'Invalid history context');
  }
}
async function postHistory(context: HistoryContext, endpoint: 'list' | 'detail', body: Record<string, string>, csrfToken: string, signal?: AbortSignal): Promise<unknown> {
  ensureContext(context, csrfToken);
  const url = `/api/workflow/clinics/${context.clinicSlug}/consultations/history/${endpoint}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', credentials: 'include', cache: 'no-store', mode: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ appointmentId: context.appointmentId, clinicDate: context.clinicDate, ...body }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ConsultationApiError(null, 'Patient history unavailable');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const fromApi = contentType === 'application/json' || contentType?.endsWith('+json');
  if (!response.ok) throw new ConsultationApiError(fromApi ? response.status : null, 'Patient history request failed');
  if (!fromApi) throw new ConsultationApiError(null, 'Invalid patient history response');
  try { return await response.json(); }
  catch { throw new ConsultationApiError(null, 'Invalid patient history response'); }
}
function parseVisit(value: unknown, context: HistoryContext): HistoryVisit {
  if (!isRecord(value) || !opaque(value.historyId) || value.clinicSlug !== context.clinicSlug ||
      value.patientId !== context.patientId || value.status !== 'finalized' ||
      !validTime(value.visitAt) || Date.parse(value.visitAt) >= Date.parse(context.currentVisitAt) ||
      !validTime(value.finalizedAt) || !isRecord(value.doctor) ||
      !validId(value.doctor.id) || !nonempty(value.doctor.displayName)) {
    throw new ConsultationApiError(null, 'History visit identity or status mismatch');
  }
  return {
    historyId: value.historyId, clinicSlug: context.clinicSlug, patientId: context.patientId,
    status: 'finalized', visitAt: value.visitAt, finalizedAt: value.finalizedAt,
    doctor: { id: value.doctor.id, displayName: value.doctor.displayName },
  };
}
function parseVitals(value: unknown): Vitals | null {
  if (value === null) return null;
  if (!isRecord(value) || !validTime(value.observedAt) || !validTime(value.recordedAt) ||
      !nonempty(value.recordedBySub) || !nonempty(value.recordedByDisplayName)) {
    throw new ConsultationApiError(null, 'Invalid history vitals');
  }
  for (const field of ['systolicBpMmHg', 'diastolicBpMmHg', 'pulseBpm', 'spo2Percent', 'temperatureC', 'weightKg', 'heightCm']) {
    if (value[field] !== undefined && (typeof value[field] !== 'number' || !Number.isFinite(value[field]))) {
      throw new ConsultationApiError(null, 'Invalid history vitals');
    }
  }
  return value as unknown as Vitals;
}
function parseNote(value: unknown): ConsultationNote {
  if (!isRecord(value) || !['chiefComplaint', 'history', 'exam', 'assessment', 'plan'].every((field) => typeof value[field] === 'string')) {
    throw new ConsultationApiError(null, 'Invalid history note');
  }
  return value as unknown as ConsultationNote;
}
function parseMedications(value: unknown): Medication[] {
  if (!Array.isArray(value) || value.length > 20) throw new ConsultationApiError(null, 'Invalid history medicines');
  return value.map(parseMedication);
}

export async function listPatientHistory(context: HistoryContext, csrfToken: string, cursor?: string, signal?: AbortSignal): Promise<HistoryPage> {
  if (cursor !== undefined && !opaque(cursor)) throw new ConsultationApiError(null, 'Invalid history cursor');
  const value = await postHistory(context, 'list', cursor === undefined ? {} : { cursor }, csrfToken, signal);
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 10 ||
      !(value.nextCursor === null || opaque(value.nextCursor))) {
    throw new ConsultationApiError(null, 'Invalid history page');
  }
  const items = value.items.map((item: unknown) => parseVisit(item, context));
  if (new Set(items.map((item) => item.historyId)).size !== items.length ||
      items.some((item, index) => index > 0 && Date.parse(item.visitAt) > Date.parse(items[index - 1].visitAt)) ||
      (value.nextCursor !== null && (items.length === 0 || value.nextCursor === cursor))) {
    throw new ConsultationApiError(null, 'Invalid history pagination');
  }
  return { items, nextCursor: value.nextCursor };
}
export async function readPatientHistory(context: HistoryContext, item: HistoryVisit, csrfToken: string, signal?: AbortSignal): Promise<HistoryDetail> {
  const expected = parseVisit(item, context);
  const value = await postHistory(context, 'detail', { historyId: expected.historyId }, csrfToken, signal);
  if (!isRecord(value)) throw new ConsultationApiError(null, 'Invalid history detail');
  const visit = parseVisit(value.history, context);
  if (visit.historyId !== expected.historyId || visit.visitAt !== expected.visitAt ||
      visit.finalizedAt !== expected.finalizedAt || visit.doctor.id !== expected.doctor.id ||
      visit.doctor.displayName !== expected.doctor.displayName || !isRecord(value.history)) {
    throw new ConsultationApiError(null, 'History detail does not match selected visit');
  }
  return {
    ...visit,
    vitals: parseVitals(value.history.vitals),
    note: parseNote(value.history.note),
    medications: parseMedications(value.history.medications),
  };
}
