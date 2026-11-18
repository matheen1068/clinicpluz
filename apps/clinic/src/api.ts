export type ClinicRole = 'clinic_admin' | 'doctor' | 'receptionist' | 'nurse' | 'lab_tech' | 'billing' | 'pharmacist';

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
  readonly code: string | null;

  constructor(status: number | null, message: string, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const ROLES = new Set<ClinicRole>(['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing', 'pharmacist']);

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

  if (!response.ok) {
    // A missing /api/* CloudFront behavior reaches S3 and returns an HTML/XML
    // error. Do not mistake that for a deliberate rejection by the JSON API.
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    const fromApi = contentType === 'application/json' || contentType?.endsWith('+json');
    let code: string | null = null;
    if (fromApi) {
      try {
        const failure: unknown = await response.json();
        if (isRecord(failure) && typeof failure.code === 'string' && /^[a-z_]{1,32}$/.test(failure.code)) code = failure.code;
      } catch { /* generic failure */ }
    }
    throw new ApiError(fromApi ? response.status : null, 'Clinic request failed', code);
  }
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

export async function setNewPassword(slug: string, username: string, temporaryPassword: string, newPassword: string, csrfToken: string): Promise<StaffSession> {
  return assertSession(await request(clinicPath(slug, 'auth/set-password'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ username, password: temporaryPassword, newPassword }),
  }));
}

export async function requestPasswordReset(slug: string, username: string, csrfToken: string): Promise<void> {
  await request(clinicPath(slug, 'auth/forgot'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ username }),
  });
}

export async function confirmPasswordReset(slug: string, username: string, code: string, newPassword: string, csrfToken: string): Promise<void> {
  await request(clinicPath(slug, 'auth/reset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ username, code, newPassword }),
  });
}

export async function signOut(slug: string, csrfToken: string): Promise<void> {
  await request(clinicPath(slug, 'auth/logout'), {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  });
}
