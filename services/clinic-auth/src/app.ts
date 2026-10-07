import { randomToken, hashToken, safeTokenEqual, verifyPassword, getCookie, sessionCookie, clearCookie, hashPassword } from './security.ts';
import { AuthStore, type Clinic, type Staff } from './store.ts';

const PRE_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;
const RESERVED = new Set(['admin', 'api', 'app', 'control', 'controlpanel', 'staging', 'www']);

export interface AppOptions {
  publicPort: number;
  now?: () => number;
}

function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function empty(status: number, cookies: string[] = []): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status, headers });
}

function resolveHost(host: string | null, publicPort: number): { hostSlug: string | null; origin: string } | null {
  if (!host) return null;
  const normalized = host.toLowerCase();
  if (normalized === `localhost:${publicPort}`) return { hostSlug: null, origin: `http://${normalized}` };
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.localhost:(\d{1,5})$/.exec(normalized);
  if (!match || Number(match[2]) !== publicPort || RESERVED.has(match[1])) return null;
  return { hostSlug: match[1], origin: `http://${normalized}` };
}

function authenticatedBody(clinic: Clinic, staff: Staff, csrfToken: string) {
  return {
    clinicSlug: clinic.slug,
    csrfToken,
    user: { id: staff.id, displayName: staff.display_name, role: staff.role },
  };
}

async function readCredentials(request: Request): Promise<{ username: string; password: string } | null> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
  const text = await request.text();
  if (text.length > 4096) return null;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9._@+-]{3,128}$/.test(normalized) || password.length < 1 || password.length > 256) return null;
  return { username: normalized, password };
}

export function createClinicAuthApp(store: AuthStore, options: AppOptions) {
  const now = options.now ?? Date.now;
  const dummy = hashPassword(randomToken());

  return {
    async handle(request: Request): Promise<Response> {
      const host = resolveHost(request.headers.get('host'), options.publicPort);
      if (!host) return json({ error: 'Invalid clinic host' }, 421);

      let pathname: string;
      try { pathname = new URL(request.url).pathname; } catch { return json({ error: 'Bad request' }, 400); }
      const route = /^\/api\/clinics\/([a-z0-9-]+)\/(bootstrap|auth\/session|auth\/login|auth\/logout)$/.exec(pathname);
      if (!route || route[1].length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(route[1]) || RESERVED.has(route[1])) {
        return json({ error: 'Not found' }, 404);
      }
      const routeSlug = route[1];
      if (host.hostSlug && host.hostSlug !== routeSlug) return json({ error: 'Clinic URL mismatch' }, 403);
      const clinic = store.findClinic(routeSlug);
      if (!clinic) return json({ error: 'Clinic not found' }, 404);
      const preCookie = `cpz_local_pre_${routeSlug}`;
      const sessionCookieName = `cpz_local_session_${routeSlug}`;
      const cookieHeader = request.headers.get('cookie');
      const currentTime = now();

      if (request.method === 'GET' && route[2] === 'bootstrap') {
        store.purgeExpired(currentTime);
        const existing = getCookie(cookieHeader, preCookie);
        const found = existing ? store.findAnonymous(hashToken(existing), clinic.id, currentTime) : null;
        const token = found ? existing! : randomToken();
        const csrfToken = found?.csrf_token ?? randomToken();
        if (!found) store.putAnonymous(hashToken(token), clinic.id, csrfToken, currentTime + PRE_TTL_MS);
        return json({ clinic: { slug: clinic.slug, displayName: clinic.display_name }, csrfToken }, 200,
          found ? [] : [sessionCookie(preCookie, token, PRE_TTL_MS / 1000)]);
      }

      if (request.method === 'GET' && route[2] === 'auth/session') {
        const sessionToken = getCookie(cookieHeader, sessionCookieName);
        const session = sessionToken ? store.findSession(hashToken(sessionToken), clinic.id, currentTime) : null;
        if (!session) return json({ error: 'Not signed in' }, 401);
        return json({ clinicSlug: clinic.slug, csrfToken: session.csrf_token,
          user: { id: session.staff_id, displayName: session.display_name, role: session.role } });
      }

      if (request.method === 'POST' && route[2] === 'auth/login') {
        if (request.headers.get('origin') !== host.origin) return json({ error: 'Origin rejected' }, 403);
        const preToken = getCookie(cookieHeader, preCookie);
        const pre = preToken ? store.findAnonymous(hashToken(preToken), clinic.id, currentTime) : null;
        const csrf = request.headers.get('x-csrf-token');
        if (!pre || !csrf || !safeTokenEqual(csrf, pre.csrf_token)) return json({ error: 'CSRF rejected' }, 403);
        const credentials = await readCredentials(request);
        if (!credentials) return json({ error: 'Invalid request' }, 400);
        if (store.isLocked(clinic.id, credentials.username, currentTime)) return json({ error: 'Too many attempts' }, 429);

        const staff = store.findStaff(clinic.id, credentials.username);
        const matched = verifyPassword(credentials.password, staff?.password_salt ?? dummy.salt, staff?.password_hash ?? dummy.hash);
        if (!staff || !matched || !staff.active) {
          store.recordFailure(clinic.id, credentials.username, currentTime);
          return json({ error: 'Incorrect credentials' }, 401);
        }

        store.clearFailures(clinic.id, credentials.username);
        store.deleteAnonymous(hashToken(preToken!));
        const sessionToken = randomToken();
        const sessionCsrf = randomToken();
        store.putSession(hashToken(sessionToken), clinic.id, staff.id, sessionCsrf, currentTime + SESSION_TTL_MS);
        return json(authenticatedBody(clinic, staff, sessionCsrf), 200, [
          clearCookie(preCookie),
          sessionCookie(sessionCookieName, sessionToken, SESSION_TTL_MS / 1000),
        ]);
      }

      if (request.method === 'POST' && route[2] === 'auth/logout') {
        if (request.headers.get('origin') !== host.origin) return json({ error: 'Origin rejected' }, 403);
        const sessionToken = getCookie(cookieHeader, sessionCookieName);
        const session = sessionToken ? store.findSession(hashToken(sessionToken), clinic.id, currentTime) : null;
        if (!session) return json({ error: 'Not signed in' }, 401);
        const csrf = request.headers.get('x-csrf-token');
        if (!csrf || !safeTokenEqual(csrf, session.csrf_token)) return json({ error: 'CSRF rejected' }, 403);
        store.deleteSession(hashToken(sessionToken!));
        return empty(204, [clearCookie(sessionCookieName)]);
      }

      return json({ error: 'Not found' }, 404);
    },
  };
}
