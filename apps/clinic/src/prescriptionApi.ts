import { ConsultationApiError, parsePrintablePrescription, type PrintablePrescription } from './consultationApi.ts';
import { validClinicSlug } from './tenant.ts';

export interface PrescriptionQueueItem {
  appointmentId: string;
  clinicDate: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  startAt: string;
  finalizedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);

async function request(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init, credentials: 'include', cache: 'no-store', mode: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', ...init.headers },
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ConsultationApiError(null, 'Prescription service unavailable');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const fromApi = contentType === 'application/json' || contentType?.endsWith('+json');
  if (!response.ok) throw new ConsultationApiError(fromApi ? response.status : null, 'Prescription request failed');
  if (!fromApi) throw new ConsultationApiError(null, 'Invalid prescription response');
  try { return await response.json(); }
  catch { throw new ConsultationApiError(null, 'Invalid prescription response'); }
}

function basePath(slug: string): string {
  if (!validClinicSlug(slug)) throw new ConsultationApiError(null, 'Invalid clinic context');
  return `/api/workflow/clinics/${slug}/consultations/prescriptions`;
}

function parseQueueItem(value: unknown, date: string): PrescriptionQueueItem {
  if (!isRecord(value) || !validId(value.appointmentId) || value.clinicDate !== date ||
      !validId(value.patientId) || !nonempty(value.patientName) ||
      !validId(value.doctorId) || !nonempty(value.doctorName) ||
      !validTime(value.startAt) || !validTime(value.finalizedAt) ||
      !onlyKeys(value, ['appointmentId', 'clinicDate', 'patientId', 'patientName', 'doctorId', 'doctorName', 'startAt', 'finalizedAt'])) {
    throw new ConsultationApiError(null, 'Invalid finalized prescription queue item');
  }
  return value as unknown as PrescriptionQueueItem;
}

export async function listFinalizedPrescriptions(slug: string, date: string, signal?: AbortSignal): Promise<PrescriptionQueueItem[]> {
  if (!validDate(date)) throw new ConsultationApiError(null, 'Invalid prescription date');
  const value = await request(`${basePath(slug)}?date=${date}`, { method: 'GET', signal });
  if (!isRecord(value) || !onlyKeys(value, ['items']) || !Array.isArray(value.items) || value.items.length > 200) {
    throw new ConsultationApiError(null, 'Invalid finalized prescription queue');
  }
  const items = value.items.map((item: unknown) => parseQueueItem(item, date));
  if (new Set(items.map((item) => item.appointmentId)).size !== items.length) {
    throw new ConsultationApiError(null, 'Duplicate finalized prescription');
  }
  return items;
}

export async function readFinalizedPrescription(slug: string, item: PrescriptionQueueItem, csrfToken: string, signal?: AbortSignal): Promise<PrintablePrescription> {
  if (!validDate(item.clinicDate) || !validId(item.appointmentId) || !nonempty(csrfToken)) {
    throw new ConsultationApiError(null, 'Invalid prescription selection');
  }
  const value = await request(`${basePath(slug)}/read`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ appointmentId: item.appointmentId, clinicDate: item.clinicDate }),
  });
  if (!isRecord(value) || !onlyKeys(value, ['status', 'printablePrescription']) || value.status !== 'finalized' ||
      !isRecord(value.printablePrescription) ||
      !onlyKeys(value.printablePrescription, ['clinic', 'doctor', 'patient', 'appointmentDate', 'finalizedAt', 'medications']) ||
      !isRecord(value.printablePrescription.patient) ||
      !onlyKeys(value.printablePrescription.patient, ['id', 'fullName', 'ageYears', 'sex']) ||
      !Array.isArray(value.printablePrescription.medications) ||
      !value.printablePrescription.medications.every((medicine) => isRecord(medicine) &&
        onlyKeys(medicine, ['name', 'strength', 'dose', 'route', 'frequency', 'duration', 'instructions', 'timing']))) {
    throw new ConsultationApiError(null, 'Invalid finalized prescription projection');
  }
  const prescription = parsePrintablePrescription(value.printablePrescription);
  if (prescription.clinic.slug !== slug || prescription.appointmentDate !== item.clinicDate ||
      prescription.patient.id !== item.patientId || prescription.doctor.id !== item.doctorId ||
      prescription.finalizedAt !== item.finalizedAt) {
    throw new ConsultationApiError(null, 'Prescription identity mismatch');
  }
  return prescription;
}
