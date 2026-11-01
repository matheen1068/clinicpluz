import { validClinicSlug } from './tenant.ts';

export interface ClinicProfile {
  slug: string;
  displayName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  revision: number;
  logo: { url: string; contentType: 'image/png' | 'image/jpeg' } | null;
}
export interface ProfileAccess { profile: ClinicProfile; canEdit: boolean }
export interface ProfileDraft { displayName: string; address: string; phone: string; email: string }
export interface ProfileUpdate {
  expectedRevision: number;
  displayName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export class ClinicProfileApiError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) {
    super(message);
    this.name = 'ClinicProfileApiError';
    this.status = status;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
const optionalText = (value: unknown, max: number): value is string | null =>
  value === null || text(value, max);
const revision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const logoPath = (slug: string) => `/api/workflow/clinics/${slug}/profile/logo`;

function endpoint(slug: string, suffix = ''): string {
  if (!validClinicSlug(slug) || (suffix !== '' && suffix !== '/logo')) {
    throw new ClinicProfileApiError(null, 'Invalid clinic profile route');
  }
  return `/api/workflow/clinics/${slug}/profile${suffix}`;
}
function parseProfile(value: unknown, slug: string): ClinicProfile {
  if (!record(value) || value.slug !== slug || !text(value.displayName, 120) ||
      !optionalText(value.address, 300) || !optionalText(value.phone, 30) ||
      !optionalText(value.email, 254) || !revision(value.revision) ||
      !(value.logo === null || (record(value.logo) && value.logo.url === logoPath(slug) &&
        (value.logo.contentType === 'image/png' || value.logo.contentType === 'image/jpeg')))) {
    throw new ClinicProfileApiError(null, 'Invalid clinic profile response');
  }
  return {
    slug, displayName: value.displayName, address: value.address, phone: value.phone,
    email: value.email, revision: value.revision,
    logo: value.logo === null ? null : { url: logoPath(slug),
      contentType: value.logo.contentType as 'image/png' | 'image/jpeg' },
  };
}
function parseAccess(value: unknown, slug: string): ProfileAccess {
  if (!record(value) || typeof value.canEdit !== 'boolean') {
    throw new ClinicProfileApiError(null, 'Invalid clinic profile response');
  }
  return { profile: parseProfile(value.profile, slug), canEdit: value.canEdit };
}
function csrfHeaders(csrfToken: string): HeadersInit {
  if (!csrfToken.trim()) throw new ClinicProfileApiError(null, 'Missing authenticated CSRF token');
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken };
}
async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init, credentials: 'include', cache: 'no-store', mode: 'same-origin', redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ClinicProfileApiError(null, 'Clinic profile service unavailable');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const fromApi = contentType === 'application/json' || contentType?.endsWith('+json');
  if (!response.ok) throw new ClinicProfileApiError(fromApi ? response.status : null, 'Clinic profile request failed');
  if (!fromApi) throw new ClinicProfileApiError(null, 'Invalid clinic profile response');
  try { return await response.json(); }
  catch { throw new ClinicProfileApiError(null, 'Invalid clinic profile response'); }
}

export function validateProfileDraft(draft: ProfileDraft): string | null {
  const name = draft.displayName.trim();
  const address = draft.address.trim();
  const phone = draft.phone.trim();
  const email = draft.email.trim();
  if (name.length < 2 || name.length > 120 || /[\u0000-\u001f\u007f<>]/.test(name)) return 'Enter a clinic name between 2 and 120 characters.';
  if (address.length > 300 || /[\u0000-\u0008\u000b-\u001f\u007f<>]/.test(address)) return 'Keep the address within 300 characters.';
  if (phone && (!/^\+?[0-9][0-9 ()-]{5,29}$/.test(phone) || (phone.match(/\d/g)?.length ?? 0) < 7 || (phone.match(/\d/g)?.length ?? 0) > 15)) {
    return 'Enter a contact phone with 7 to 15 digits, or leave it blank.';
  }
  if (email && (email.length > 254 || /[<>\u0000-\u001f\u007f]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return 'Enter a valid contact email, or leave it blank.';
  }
  return null;
}
export function profileUpdate(draft: ProfileDraft, expectedRevision: number): ProfileUpdate {
  const error = validateProfileDraft(draft);
  if (error || !revision(expectedRevision)) throw new ClinicProfileApiError(null, error ?? 'Invalid profile revision');
  return {
    expectedRevision, displayName: draft.displayName.trim().replace(/\s+/g, ' '),
    address: draft.address.trim().replace(/\s+/g, ' ') || null, phone: draft.phone.trim().replace(/\s+/g, ' ') || null,
    email: draft.email.trim().toLowerCase() || null,
  };
}
export function draftFromProfile(profile: ClinicProfile): ProfileDraft {
  return { displayName: profile.displayName, address: profile.address ?? '',
    phone: profile.phone ?? '', email: profile.email ?? '' };
}

export async function getClinicProfile(slug: string, signal?: AbortSignal): Promise<ProfileAccess> {
  return parseAccess(await request(endpoint(slug), { signal }), slug);
}
export async function saveClinicProfile(slug: string, draft: ProfileDraft, expectedRevision: number, csrfToken: string): Promise<ProfileAccess> {
  return parseAccess(await request(endpoint(slug), {
    method: 'PUT', headers: csrfHeaders(csrfToken), body: JSON.stringify(profileUpdate(draft, expectedRevision)),
  }), slug);
}
export async function uploadClinicLogo(slug: string, file: File, expectedRevision: number, csrfToken: string): Promise<ProfileAccess> {
  if (!revision(expectedRevision) || !['image/png', 'image/jpeg'].includes(file.type) || file.size < 1 || file.size > 3_000_000) {
    throw new ClinicProfileApiError(null, 'Choose a PNG or JPEG logo up to 3 MB.');
  }
  const prepared = await request(`${endpoint(slug, '/logo')}/prepare`, {
    method: 'POST', headers: csrfHeaders(csrfToken),
    body: JSON.stringify({ expectedRevision, contentType: file.type }),
  });
  if (!record(prepared) || typeof prepared.uploadId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(prepared.uploadId) ||
      typeof prepared.url !== 'string' || !record(prepared.fields)) {
    throw new ClinicProfileApiError(null, 'Invalid logo upload response');
  }
  const url = new URL(prepared.url);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.s3\.ap-south-1\.amazonaws\.com$/.test(url.hostname) ||
      url.pathname !== '/' || url.search || url.hash ||
      prepared.fields.key !== `staged/${slug}/${prepared.uploadId}.${file.type === 'image/png' ? 'png' : 'jpg'}` ||
      prepared.fields['Content-Type'] !== file.type ||
      Object.keys(prepared.fields).length > 20 ||
      Object.values(prepared.fields).some((value) => typeof value !== 'string' || value.length > 4096)) {
    throw new ClinicProfileApiError(null, 'Invalid logo upload response');
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(prepared.fields)) form.append(key, value as string);
  form.append('file', file);
  let stored: Response;
  try {
    stored = await fetch(url.toString(), { method: 'POST', body: form, credentials: 'omit',
      mode: 'cors', redirect: 'error', signal: AbortSignal.timeout(60_000) });
  } catch { throw new ClinicProfileApiError(null, 'Logo upload to storage failed. Please try again.'); }
  if (!stored.ok) throw new ClinicProfileApiError(null, 'Logo upload to storage failed. Please try again.');
  return parseAccess(await request(`${endpoint(slug, '/logo')}/complete`, {
    method: 'POST', headers: csrfHeaders(csrfToken),
    body: JSON.stringify({ expectedRevision, contentType: file.type, uploadId: prepared.uploadId }),
  }), slug);
}
export async function removeClinicLogo(slug: string, expectedRevision: number, csrfToken: string): Promise<ProfileAccess> {
  if (!revision(expectedRevision)) throw new ClinicProfileApiError(null, 'Invalid profile revision');
  return parseAccess(await request(endpoint(slug, '/logo'), {
    method: 'DELETE', headers: csrfHeaders(csrfToken), body: JSON.stringify({ expectedRevision }),
  }), slug);
}
