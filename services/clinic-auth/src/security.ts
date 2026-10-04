import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeTokenEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(24).toString('hex');
  const hash = scryptSync(password, salt, 64, SCRYPT_OPTIONS).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const actual = scryptSync(password, salt, 64, SCRYPT_OPTIONS);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function getCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  let found: string | null = null;
  for (const item of header.split(';')) {
    const equalAt = item.indexOf('=');
    if (equalAt < 0) continue;
    if (item.slice(0, equalAt).trim() !== name) continue;
    if (found !== null) return null; // Ambiguous duplicate cookies fail closed.
    const value = item.slice(equalAt + 1).trim();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) return null;
    found = value;
  }
  return found;
}

export function sessionCookie(name: string, token: string, maxAgeSeconds: number, secure = false): string {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function clearCookie(name: string, secure = false): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
