import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './security.ts';

export type ClinicRole = 'clinic_admin' | 'doctor' | 'receptionist' | 'nurse' | 'lab_tech' | 'billing';

export interface Clinic {
  id: string;
  slug: string;
  display_name: string;
  active: number;
}

export interface Staff {
  id: string;
  clinic_id: string;
  username: string;
  display_name: string;
  role: ClinicRole;
  password_salt: string;
  password_hash: string;
  active: number;
}

export interface AnonymousSession {
  id_hash: string;
  clinic_id: string;
  csrf_token: string;
  expires_at: number;
}

export interface AuthenticatedSession {
  id_hash: string;
  clinic_id: string;
  staff_id: string;
  csrf_token: string;
  expires_at: number;
  display_name: string;
  role: ClinicRole;
  active: number;
}

export const ROLES = new Set<ClinicRole>(['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing']);
const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'control', 'controlpanel', 'staging', 'www']);

export class AuthStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clinics (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS staff (
        id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), username TEXT NOT NULL,
        display_name TEXT NOT NULL, role TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, UNIQUE(clinic_id, username)
      );
      CREATE TABLE IF NOT EXISTS anonymous_sessions (
        id_hash TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), csrf_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS staff_sessions (
        id_hash TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), staff_id TEXT NOT NULL REFERENCES staff(id),
        csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        clinic_id TEXT NOT NULL REFERENCES clinics(id), username TEXT NOT NULL, failures INTEGER NOT NULL,
        window_start INTEGER NOT NULL, locked_until INTEGER NOT NULL, PRIMARY KEY (clinic_id, username)
      );
      CREATE INDEX IF NOT EXISTS idx_staff_sessions_expires ON staff_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_expires ON anonymous_sessions(expires_at);
    `);
  }

  close(): void { this.db.close(); }

  createClinic(slug: string, displayName: string): Clinic {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || RESERVED_SLUGS.has(slug) ||
        displayName.trim().length < 2) {
      throw new Error('Invalid clinic details');
    }
    const id = randomUUID();
    this.db.prepare('INSERT INTO clinics (id, slug, display_name) VALUES (?, ?, ?)').run(id, slug, displayName.trim());
    return this.findClinic(slug)!;
  }

  findClinic(slug: string): Clinic | null {
    return (this.db.prepare('SELECT * FROM clinics WHERE slug = ? AND active = 1').get(slug) as unknown as Clinic | undefined) ?? null;
  }

  createStaff(clinicId: string, username: string, displayName: string, role: ClinicRole, password: string): Staff {
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9._@+-]{3,128}$/.test(normalized) || displayName.trim().length < 2 ||
        !ROLES.has(role) || password.length < 12 || password.length > 256) {
      throw new Error('Invalid staff details');
    }
    const id = randomUUID();
    const { salt, hash } = hashPassword(password);
    this.db.prepare(`INSERT INTO staff
      (id, clinic_id, username, display_name, role, password_salt, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, clinicId, normalized, displayName.trim(), role, salt, hash);
    return this.findStaff(clinicId, normalized)!;
  }

  findStaff(clinicId: string, username: string): Staff | null {
    return (this.db.prepare('SELECT * FROM staff WHERE clinic_id = ? AND username = ?').get(clinicId, username) as unknown as Staff | undefined) ?? null;
  }

  putAnonymous(idHash: string, clinicId: string, csrfToken: string, expiresAt: number): void {
    this.db.prepare('INSERT INTO anonymous_sessions VALUES (?, ?, ?, ?)').run(idHash, clinicId, csrfToken, expiresAt);
  }

  findAnonymous(idHash: string, clinicId: string, now: number): AnonymousSession | null {
    return (this.db.prepare(`SELECT * FROM anonymous_sessions
      WHERE id_hash = ? AND clinic_id = ? AND expires_at > ?`).get(idHash, clinicId, now) as unknown as AnonymousSession | undefined) ?? null;
  }

  deleteAnonymous(idHash: string): void {
    this.db.prepare('DELETE FROM anonymous_sessions WHERE id_hash = ?').run(idHash);
  }

  putSession(idHash: string, clinicId: string, staffId: string, csrfToken: string, expiresAt: number): void {
    this.db.prepare('INSERT INTO staff_sessions VALUES (?, ?, ?, ?, ?)').run(idHash, clinicId, staffId, csrfToken, expiresAt);
  }

  findSession(idHash: string, clinicId: string, now: number): AuthenticatedSession | null {
    return (this.db.prepare(`SELECT s.*, u.display_name, u.role, u.active
      FROM staff_sessions s JOIN staff u ON s.staff_id = u.id AND s.clinic_id = u.clinic_id
      WHERE s.id_hash = ? AND s.clinic_id = ? AND s.expires_at > ? AND u.active = 1`)
      .get(idHash, clinicId, now) as unknown as AuthenticatedSession | undefined) ?? null;
  }

  deleteSession(idHash: string): void {
    this.db.prepare('DELETE FROM staff_sessions WHERE id_hash = ?').run(idHash);
  }

  purgeExpired(now: number): void {
    this.db.prepare('DELETE FROM anonymous_sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM staff_sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM login_attempts WHERE locked_until <= ? AND window_start <= ?')
      .run(now - 15 * 60_000, now - 15 * 60_000);
  }

  isLocked(clinicId: string, username: string, now: number): boolean {
    const row = this.db.prepare('SELECT locked_until FROM login_attempts WHERE clinic_id = ? AND username = ?')
      .get(clinicId, username) as { locked_until: number } | undefined;
    return Boolean(row && row.locked_until > now);
  }

  recordFailure(clinicId: string, username: string, now: number): void {
    const row = this.db.prepare('SELECT failures, window_start FROM login_attempts WHERE clinic_id = ? AND username = ?')
      .get(clinicId, username) as { failures: number; window_start: number } | undefined;
    const withinWindow = Boolean(row && row.window_start > now - 15 * 60_000);
    const failures = withinWindow && row ? row.failures + 1 : 1;
    const windowStart = withinWindow && row ? row.window_start : now;
    const lockedUntil = failures >= 5 ? now + 15 * 60_000 : now;
    this.db.prepare(`INSERT INTO login_attempts (clinic_id, username, failures, window_start, locked_until) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(clinic_id, username) DO UPDATE SET failures = excluded.failures,
      window_start = excluded.window_start, locked_until = excluded.locked_until`)
      .run(clinicId, username, failures, windowStart, lockedUntil);
  }

  clearFailures(clinicId: string, username: string): void {
    this.db.prepare('DELETE FROM login_attempts WHERE clinic_id = ? AND username = ?').run(clinicId, username);
  }
}
