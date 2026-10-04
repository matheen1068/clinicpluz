import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AuthStore, ROLES, type ClinicRole } from './store.ts';

if (process.env.CLINIC_AUTH_LOCAL_ONLY !== '1' || process.env.NODE_ENV === 'production') {
  throw new Error('Local seed is disabled outside explicit local development mode.');
}
process.umask(0o077);

const dbPath = resolve(process.env.CLINIC_AUTH_DB_PATH ?? 'data/local-auth.sqlite');
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
const store = new AuthStore(dbPath);

async function passwordFromStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('Supply the password on stdin; the CLI will not echo or log it.');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1024) throw new Error('Password input is too long');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'clinic' && args.length === 2) {
    const [slug, displayName] = args;
    const clinic = store.createClinic(slug, displayName);
    console.log(`Created local clinic ${clinic.slug}.`);
  } else if (command === 'staff' && args.length === 4) {
    const [slug, username, displayName, roleText] = args;
    const role = roleText as ClinicRole;
    if (!ROLES.has(role)) throw new Error('Unsupported staff role');
    const clinic = store.findClinic(slug);
    if (!clinic) throw new Error('Clinic not found; create it first');
    const password = await passwordFromStdin();
    store.createStaff(clinic.id, username, displayName, role, password);
    console.log(`Created local staff account ${username} for ${clinic.slug}.`);
  } else {
    throw new Error('Usage: seed-local.ts clinic <slug> <display name> | staff <slug> <username> <display name> <role> <password on stdin>');
  }
} finally {
  store.close();
}
