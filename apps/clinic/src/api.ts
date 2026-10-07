export type ClinicRole = 'clinic_admin' | 'doctor' | 'receptionist' | 'nurse' | 'lab_tech' | 'billing';

export interface ClinicBootstrap {
  clinic: {
    slug: string;
    displayName: string;
  };
  csrfToken: string;
}

export interface StaffSession {
  clinicSlug: string;
  csrfToken: string;
  user: {
    id: string;
    displayName: string;
    role: ClinicRole;
  };
}

export class ApiError extends Error {
  readonly status: number | null;

  constructor(status: number | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const ROLES = new Set<ClinicRole>(['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertBootstrap(value: unknown): ClinicBootstrap {
  if (!isRecord(value) || !isRecord(value.clinic) ||
      !isNonEmptyString(value.clinic.slug) || !isNonEmptyString(value.clinic.displayName) ||
      !isNonEmptyString(value.csrfToken)) {
    throw new ApiError(null, 'Invalid clinic bootstrap response');
  }
  return value as unknown as ClinicBootstrap;
}

function assertSession(value: unknown): StaffSession {
  if (!isRecord(value) || !isNonEmptyString(value.clinicSlug) || !isNonEmptyString(value.csrfToken) || !isRecord(value.user) ||
      !isNonEmptyString(value.user.id) || !isNonEmptyString(value.user.displayName) ||
      !ROLES.has(value.user.role as ClinicRole)) {
    throw new ApiError(null, 'Invalid staff session response');
  }
  return value as unknown as StaffSession;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(null, 'Clinic service is unavailable');
  }

  if (!response.ok) throw new ApiError(response.status, 'Clinic request failed');
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new ApiError(null, 'Invalid clinic service response');
  }
}

function clinicPath(slug: string, endpoint: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || endpoint.startsWith('/')) {
    throw new ApiError(null, 'Invalid clinic request');
  }
  return `/api/clinics/${slug}/${endpoint}`;
}

export async function getClinicBootstrap(slug: string): Promise<ClinicBootstrap> {
  return assertBootstrap(await request(clinicPath(slug, 'bootstrap')));
}

export async function getStaffSession(slug: string): Promise<StaffSession | null> {
  try {
    return assertSession(await request(clinicPath(slug, 'auth/session')));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signIn(slug: string, username: string, password: string, csrfToken: string): Promise<StaffSession> {
  return assertSession(await request(clinicPath(slug, 'auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ username, password }),
  }));
}

export async function signOut(slug: string, csrfToken: string): Promise<void> {
  await request(clinicPath(slug, 'auth/logout'), {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  });
}
