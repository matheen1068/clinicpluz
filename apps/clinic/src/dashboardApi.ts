import { validClinicSlug } from './tenant.ts';

export interface DashboardCounts {
  total: number;
  booked: number;
  checkedIn: number;
  pending: number;
  completed: number;
  phone: number;
  walkIn: number;
}
export interface DashboardSummary { date: string; scope: 'clinic' | 'doctor'; counts: DashboardCounts }

export class DashboardApiError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) { super(message); this.name = 'DashboardApiError'; this.status = status; }
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 200;

export async function getDashboard(slug: string, date: string, signal?: AbortSignal): Promise<DashboardSummary> {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!validClinicSlug(slug) || !datePattern.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new DashboardApiError(null, 'Invalid dashboard selection');
  }
  let response: Response;
  try {
    response = await fetch(`/api/workflow/clinics/${slug}/dashboard?date=${date}`, {
      credentials: 'include', cache: 'no-store', mode: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DashboardApiError(null, 'Dashboard service unavailable');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const json = contentType === 'application/json' || contentType?.endsWith('+json');
  if (!response.ok) throw new DashboardApiError(json ? response.status : null, 'Dashboard request failed');
  if (!json) throw new DashboardApiError(null, 'Invalid dashboard response');
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new DashboardApiError(null, 'Invalid dashboard response'); }
  if (!isRecord(value) || value.date !== date || (value.scope !== 'clinic' && value.scope !== 'doctor') || !isRecord(value.counts)) {
    throw new DashboardApiError(null, 'Invalid dashboard response');
  }
  const counts = value.counts;
  if (!['total', 'booked', 'checkedIn', 'pending', 'completed', 'phone', 'walkIn'].every((field) => count(counts[field]))) {
    throw new DashboardApiError(null, 'Invalid dashboard counts');
  }
  const verified = counts as unknown as DashboardCounts;
  if (verified.booked + verified.pending + verified.completed !== verified.total ||
      verified.phone + verified.walkIn !== verified.total) throw new DashboardApiError(null, 'Invalid dashboard counts');
  return { date, scope: value.scope, counts: verified };
}
