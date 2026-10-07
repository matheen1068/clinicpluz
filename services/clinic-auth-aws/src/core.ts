import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const PRE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 60 * 60;
const FAILURE_WINDOW_SECONDS = 15 * 60;
const RESERVED = new Set(['admin', 'api', 'app', 'control', 'controlpanel', 'staging', 'www']);
const PRE_COOKIE = '__Host-cpz_pre';
const SESSION_COOKIE = '__Host-cpz_session';

export type Role = 'clinic_admin' | 'doctor' | 'receptionist' | 'nurse' | 'lab_tech' | 'billing';
export const ROLES = new Set<Role>(['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing']);

export interface Clinic { slug: string; displayName: string; active: boolean }
export interface Membership {
  clinicSlug: string;
  username: string;
  cognitoUsername: string;
  sub: string;
  displayName: string;
  role: Role;
  active: boolean;
}
export interface PreSession { clinicSlug: string; csrfToken: string; expiresAt: number }
export interface StaffSession { clinicSlug: string; username: string; sub: string; csrfToken: string; expiresAt: number }

export interface AuthRepository {
  getClinic(slug: string): Promise<Clinic | null>;
  getMembership(slug: string, username: string): Promise<Membership | null>;
  getPre(tokenHash: string): Promise<PreSession | null>;
  putPre(tokenHash: string, pre: PreSession): Promise<void>;
  createSessionConsumePre(preHash: string, sessionHash: string, session: StaffSession, nowSeconds: number): Promise<boolean>;
  getSession(tokenHash: string): Promise<StaffSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
  getFailureCount(slug: string, username: string, window: number): Promise<number>;
  recordFailure(slug: string, username: string, window: number, expiresAt: number): Promise<void>;
}

export type CognitoResult = { kind: 'authenticated'; sub: string } | { kind: 'challenge' };
export interface IdentityProvider {
  authenticate(cognitoUsername: string, password: string): Promise<CognitoResult>;
  isActive(cognitoUsername: string, sub: string): Promise<boolean>;
}

export class IdentityError extends Error {
  readonly kind: 'invalid-credentials' | 'throttled';
  constructor(kind: 'invalid-credentials' | 'throttled') {
    super(kind);
    this.kind = kind;
  }
}

export interface HttpInput {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
}
export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
}
export interface AppConfig { publicOrigin: string; edgeKey: string; now?: () => number }

function token(): string { return randomBytes(32).toString('base64url'); }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}
function validSlug(value: string): boolean {
  return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && !RESERVED.has(value);
}
function response(statusCode: number, body: unknown, cookies?: string[]): HttpResult {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
    ...(cookies ? { cookies } : {}),
    body: statusCode === 204 ? '' : JSON.stringify(body),
  };
}
function setCookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}
function clearCookie(name: string): string {
  return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
function readCookie(input: HttpInput, name: string): { valid: boolean; value: string | null } {
  // Payload v2's cookies array is authoritative; header normalization can also
  // leave a coalesced Cookie header. Duplicate names inside the chosen source fail.
  const header = input.cookies ? input.cookies.join('; ') : input.headers.cookie ?? '';
  let found: string | null = null;
  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals < 0 || part.slice(0, equals).trim() !== name) continue;
    const value = part.slice(equals + 1).trim();
    if (found !== null || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) return { valid: false, value: null };
    found = value;
  }
  return { valid: true, value: found };
}
function credentials(input: HttpInput): { username: string; password: string } | null {
  if (!input.headers['content-type']?.toLowerCase().startsWith('application/json') ||
      !input.body || input.body.length > 4096 || input.isBase64Encoded) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(input.body); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { username, password } = parsed as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9._@+-]{3,128}$/.test(normalized) || password.length < 1 || password.length > 256) return null;
  return { username: normalized, password };
}

export function createAuthApp(repo: AuthRepository, identity: IdentityProvider, config: AppConfig) {
  const origin = new URL(config.publicOrigin);
  if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudfront\.net$/.test(origin.hostname) ||
      origin.origin !== config.publicOrigin || config.edgeKey.length < 32) throw new Error('Invalid staging auth configuration');
  const now = config.now ?? Date.now;

  async function currentSession(input: HttpInput, slug: string, nowSeconds: number): Promise<{ state: 'missing' | 'invalid' | 'wrong-clinic' | 'active'; hash?: string; session?: StaffSession; member?: Membership }> {
    const cookie = readCookie(input, SESSION_COOKIE);
    if (!cookie.valid) return { state: 'invalid' };
    if (!cookie.value) return { state: 'missing' };
    const hash = sha256(cookie.value);
    const session = await repo.getSession(hash);
    if (!session || session.expiresAt <= nowSeconds) return { state: 'missing' };
    if (session.clinicSlug !== slug) return { state: 'wrong-clinic' };
    const clinic = await repo.getClinic(slug);
    const member = await repo.getMembership(slug, session.username);
    if (!clinic?.active || !member?.active || member.sub !== session.sub || member.clinicSlug !== slug ||
        !ROLES.has(member.role) || !(await identity.isActive(member.cognitoUsername, member.sub))) {
      await repo.deleteSession(hash);
      return { state: 'missing' };
    }
    return { state: 'active', hash, session, member };
  }

  return {
    async handle(input: HttpInput): Promise<HttpResult> {
      try {
        if (!safeEqual(input.headers['x-clinicpluz-edge-key'] ?? '', config.edgeKey)) return response(403, { error: 'Forbidden' });
        if (input.headers.origin && input.headers.origin !== config.publicOrigin) return response(403, { error: 'Origin rejected' });
        const match = /^\/api\/clinics\/([a-z0-9-]+)\/(bootstrap|auth\/session|auth\/login|auth\/logout)$/.exec(input.path);
        if (!match || !validSlug(match[1])) return response(404, { error: 'Not found' });
        const slug = match[1];
        const endpoint = match[2];
        const nowSeconds = Math.floor(now() / 1000);
        const clinic = await repo.getClinic(slug);
        if (!clinic?.active || clinic.slug !== slug) return response(404, { error: 'Clinic not found' });

        if (input.method === 'GET' && endpoint === 'bootstrap') {
          const existing = readCookie(input, PRE_COOKIE);
          if (!existing.valid) return response(400, { error: 'Invalid cookie' });
          const pre = existing.value ? await repo.getPre(sha256(existing.value)) : null;
          const preToken = pre?.clinicSlug === slug && pre.expiresAt > nowSeconds ? existing.value! : token();
          const csrfToken = pre?.clinicSlug === slug && pre.expiresAt > nowSeconds ? pre.csrfToken : token();
          if (preToken !== existing.value) await repo.putPre(sha256(preToken), { clinicSlug: slug, csrfToken, expiresAt: nowSeconds + PRE_TTL_SECONDS });
          return response(200, { clinic: { slug, displayName: clinic.displayName }, csrfToken },
            preToken === existing.value ? undefined : [setCookie(PRE_COOKIE, preToken, PRE_TTL_SECONDS)]);
        }

        if (input.method === 'GET' && endpoint === 'auth/session') {
          const current = await currentSession(input, slug, nowSeconds);
          if (current.state === 'wrong-clinic') return response(403, { error: 'Clinic session mismatch' });
          if (current.state !== 'active') return response(401, { error: 'Not signed in' });
          return response(200, {
            clinicSlug: slug, csrfToken: current.session!.csrfToken,
            user: { id: current.session!.sub, displayName: current.member!.displayName, role: current.member!.role },
          });
        }

        if (input.method === 'POST' && (endpoint === 'auth/login' || endpoint === 'auth/logout')) {
          if (input.headers.origin !== config.publicOrigin) return response(403, { error: 'Origin rejected' });
          if (endpoint === 'auth/logout') {
            const current = await currentSession(input, slug, nowSeconds);
            if (current.state === 'wrong-clinic') return response(403, { error: 'Clinic session mismatch' });
            if (current.state !== 'active') return response(401, { error: 'Not signed in' }, [clearCookie(SESSION_COOKIE)]);
            if (!safeEqual(input.headers['x-csrf-token'] ?? '', current.session!.csrfToken)) return response(403, { error: 'CSRF rejected' });
            await repo.deleteSession(current.hash!);
            return response(204, null, [clearCookie(SESSION_COOKIE)]);
          }

          const existingSession = readCookie(input, SESSION_COOKIE);
          if (!existingSession.valid) return response(400, { error: 'Invalid cookie' });
          if (existingSession.value) {
            const active = await repo.getSession(sha256(existingSession.value));
            if (active && active.expiresAt > nowSeconds) return response(403, { error: 'Sign out before changing clinics' });
          }
          const preCookie = readCookie(input, PRE_COOKIE);
          if (!preCookie.valid || !preCookie.value) return response(403, { error: 'CSRF rejected' });
          const preHash = sha256(preCookie.value);
          const pre = await repo.getPre(preHash);
          if (!pre || pre.expiresAt <= nowSeconds || pre.clinicSlug !== slug ||
              !safeEqual(input.headers['x-csrf-token'] ?? '', pre.csrfToken)) return response(403, { error: 'CSRF rejected' });
          const login = credentials(input);
          if (!login) return response(400, { error: 'Invalid request' });
          const window = Math.floor(nowSeconds / FAILURE_WINDOW_SECONDS);
          if ((await repo.getFailureCount(slug, login.username, window)) >= 5) return response(429, { error: 'Too many attempts' });
          const member = await repo.getMembership(slug, login.username);
          if (!member?.active || member.clinicSlug !== slug || !ROLES.has(member.role)) {
            await repo.recordFailure(slug, login.username, window, (window + 1) * FAILURE_WINDOW_SECONDS + 60);
            return response(401, { error: 'Incorrect credentials' });
          }
          let authenticated: CognitoResult;
          try { authenticated = await identity.authenticate(member.cognitoUsername, login.password); }
          catch (error) {
            if (error instanceof IdentityError && error.kind === 'invalid-credentials') {
              await repo.recordFailure(slug, login.username, window, (window + 1) * FAILURE_WINDOW_SECONDS + 60);
              return response(401, { error: 'Incorrect credentials' });
            }
            if (error instanceof IdentityError && error.kind === 'throttled') return response(429, { error: 'Too many attempts' });
            throw error;
          }
          if (authenticated.kind === 'challenge') return response(403, { error: 'Additional sign-in step required' });
          if (authenticated.sub !== member.sub) return response(403, { error: 'Clinic membership mismatch' });
          const sessionToken = token();
          const csrfToken = token();
          const session: StaffSession = { clinicSlug: slug, username: login.username, sub: member.sub, csrfToken, expiresAt: nowSeconds + SESSION_TTL_SECONDS };
          if (!(await repo.createSessionConsumePre(preHash, sha256(sessionToken), session, nowSeconds))) return response(403, { error: 'CSRF rejected' });
          return response(200, {
            clinicSlug: slug, csrfToken,
            user: { id: member.sub, displayName: member.displayName, role: member.role },
          }, [clearCookie(PRE_COOKIE), setCookie(SESSION_COOKIE, sessionToken, SESSION_TTL_SECONDS)]);
        }
        return response(404, { error: 'Not found' });
      } catch {
        // Do not log passwords, tokens, or upstream exception bodies.
        return response(503, { error: 'Clinic sign-in is temporarily unavailable' });
      }
    },
  };
}
