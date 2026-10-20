export interface OAuthConfig {
  domain: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
}

export interface AccessSession {
  accessToken: string;
  expiresAt: number;
}

const pendingKey = 'clinicpluz.control.oauth.pending';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function configFromEnv(env: Record<string, string | undefined>, location: Location): OAuthConfig | null {
  try {
    const domain = new URL(env.VITE_OPERATOR_AUTH_DOMAIN ?? '');
    const redirect = new URL(env.VITE_OPERATOR_REDIRECT_URI ?? '');
    const logout = new URL(env.VITE_OPERATOR_LOGOUT_URI ?? '');
    const clientId = env.VITE_OPERATOR_CLIENT_ID ?? '';
    const secure = location.protocol === 'https:' || (location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname));
    if (!secure || domain.protocol !== 'https:' || domain.pathname !== '/' || domain.search || domain.hash ||
      redirect.origin !== location.origin || logout.origin !== location.origin ||
      redirect.search || redirect.hash || logout.search || logout.hash ||
      !/^[A-Za-z0-9]{8,128}$/.test(clientId)) return null;
    return { domain: domain.origin, clientId, redirectUri: redirect.href, logoutUri: logout.href };
  } catch {
    return null;
  }
}

function randomText(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startSignIn(config: OAuthConfig): Promise<void> {
  const verifier = randomText(64);
  const state = randomText(32);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(pendingKey, JSON.stringify({ verifier, state, createdAt: Date.now() }));
  const url = new URL('/oauth2/authorize', config.domain);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  window.location.assign(url.href);
}

export async function completeSignIn(config: OAuthConfig): Promise<AccessSession | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return null;
  // Remove the one-time code from the address bar and history before the network call.
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  const raw = sessionStorage.getItem(pendingKey);
  sessionStorage.removeItem(pendingKey);
  if (error || !code || !state || !raw) throw new Error('Operator sign-in was not completed. Please try again.');
  let pending: unknown;
  try { pending = JSON.parse(raw); } catch { throw new Error('Operator sign-in expired. Please try again.'); }
  if (!pending || typeof pending !== 'object' || !('state' in pending) || !('verifier' in pending) || !('createdAt' in pending) ||
    pending.state !== state || typeof pending.verifier !== 'string' || typeof pending.createdAt !== 'number' ||
    Date.now() - pending.createdAt > 10 * 60_000 || Date.now() < pending.createdAt) {
    throw new Error('Operator sign-in expired. Please try again.');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: pending.verifier,
  });
  const response = await fetch(new URL('/oauth2/token', config.domain), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('Operator sign-in could not be verified. Please try again.');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('access_token' in payload) || !('token_type' in payload) ||
    !('expires_in' in payload) || typeof payload.access_token !== 'string' || payload.token_type !== 'Bearer' ||
    typeof payload.expires_in !== 'number' || payload.expires_in < 60) {
    throw new Error('Operator sign-in returned an invalid response.');
  }
  // The access token is memory-only. The API authorizer verifies its signature and operator allowlist.
  return { accessToken: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
}

export function managedSignOut(config: OAuthConfig): void {
  sessionStorage.removeItem(pendingKey);
  const url = new URL('/logout', config.domain);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('logout_uri', config.logoutUri);
  window.location.assign(url.href);
}
