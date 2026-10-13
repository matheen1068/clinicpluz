import { ConsultationApiError } from './consultationApi.ts';
import { validClinicSlug } from './tenant.ts';

export interface PrescriptionEmailSelection { appointmentId: string; clinicDate: string }
export interface EmailPreview { status: 'ready'; recipientEmail: string; recipientMasked: string }
export interface EmailSendResult { status: 'accepted' | 'pending' | 'unknown'; recipientMasked: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validEmail = (value: unknown): value is string => typeof value === 'string' &&
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validMasked = (value: unknown): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= 254 && !/[\x00-\x1f\x7f]/.test(value);

function endpoint(slug: string, selection: PrescriptionEmailSelection, csrfToken: string, action: 'preview' | 'send') {
  if (!validClinicSlug(slug) || !validId(selection.appointmentId) || !validDate(selection.clinicDate) || !csrfToken.trim()) {
    throw new ConsultationApiError(null, 'Invalid prescription email context');
  }
  return `/api/workflow/clinics/${slug}/consultations/prescriptions/email${action === 'preview' ? '/preview' : ''}`;
}
async function post(slug: string, selection: PrescriptionEmailSelection, csrfToken: string, action: 'preview' | 'send', expectedRecipientEmail?: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const url = endpoint(slug, selection, csrfToken, action);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', credentials: 'include', cache: 'no-store', mode: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ appointmentId: selection.appointmentId, clinicDate: selection.clinicDate,
        ...(action === 'send' ? { confirmPatientEmail: true, expectedRecipientEmail } : {}) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ConsultationApiError(null, 'Prescription email service unavailable');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const fromApi = contentType === 'application/json' || contentType?.endsWith('+json');
  if (!fromApi) throw new ConsultationApiError(null, 'Invalid prescription email response');
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ConsultationApiError(null, 'Invalid prescription email response'); }
  if (!response.ok && !(action === 'send' && response.status === 409 && isRecord(body) && body.status === 'unknown')) {
    throw new ConsultationApiError(response.status, 'Prescription email request failed');
  }
  return { status: response.status, body };
}

export async function previewPrescriptionEmail(slug: string, selection: PrescriptionEmailSelection, csrfToken: string, signal?: AbortSignal): Promise<EmailPreview> {
  const { status, body } = await post(slug, selection, csrfToken, 'preview', undefined, signal);
  if (status !== 200 || !isRecord(body) || !onlyKeys(body, ['status', 'recipientEmail', 'recipientMasked']) || body.status !== 'ready' ||
      !validEmail(body.recipientEmail) || !validMasked(body.recipientMasked)) {
    throw new ConsultationApiError(null, 'Invalid prescription email preview');
  }
  return { status: 'ready', recipientEmail: body.recipientEmail, recipientMasked: body.recipientMasked };
}

export async function sendPrescriptionEmail(slug: string, selection: PrescriptionEmailSelection, csrfToken: string, expectedRecipientEmail: string): Promise<EmailSendResult> {
  if (!validEmail(expectedRecipientEmail)) throw new ConsultationApiError(null, 'A verified stored patient email is required');
  const { status, body } = await post(slug, selection, csrfToken, 'send', expectedRecipientEmail);
  if (!isRecord(body) || !onlyKeys(body, ['status', 'recipientMasked']) || !validMasked(body.recipientMasked) ||
      !((status === 200 && body.status === 'accepted') ||
        (status === 202 && (body.status === 'accepted' || body.status === 'pending')) ||
        (status === 409 && body.status === 'unknown'))) {
    throw new ConsultationApiError(null, 'Invalid prescription email outcome');
  }
  return { status: body.status as EmailSendResult['status'], recipientMasked: body.recipientMasked };
}
