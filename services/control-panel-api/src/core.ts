import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// These staff roles and record fields intentionally match clinic-auth-aws.
export const ROLES = ['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing', 'pharmacist'] as const;
export type Role = (typeof ROLES)[number];
export const MODULES = ['patient_intake', 'appointments', 'vitals', 'consultations', 'prescriptions', 'lab_reports', 'billing', 'email_notifications'] as const;
export type Module = (typeof MODULES)[number];
export type Entitlements = Record<Module, boolean>;

export interface CustomerRecord { id: string; displayName: string; createdAt: string; version: number }
export interface ClinicRecord {
  slug: string; displayName: string; active: boolean; version: number;
  customerId?: string; branchName?: string;
}
export interface BranchRecord extends ClinicRecord { customerId: string; branchName: string }
export interface Page<T> { items: T[]; nextKey: string | null }
export interface StaffRecord {
  clinicSlug: string; username: string; cognitoUsername: string; sub: string;
  displayName: string; role: Role; active: boolean; version: number;
}
export interface EntitlementsRecord { clinicSlug: string; modules: Entitlements; version: number }
export interface AuditEvent {
  id: string; clinicSlug: string; actorSub: string; action: string; target: string;
  at: string; changes: Record<string, string | boolean | number>;
}

export interface ControlRepository {
  getCustomer(id: string): Promise<CustomerRecord | null>;
  listCustomers(prefix: string, after: string | null): Promise<Page<CustomerRecord>>;
  createCustomer(customer: CustomerRecord, audit: AuditEvent): Promise<boolean>;
  getCustomerBranch(customerId: string, branchName: string): Promise<BranchRecord | null>;
  listCustomerBranches(customerId: string, after: string | null): Promise<Page<BranchRecord>>;
  listBranches(prefix: string, after: string | null): Promise<Page<BranchRecord>>;
  createBranch(branch: BranchRecord, entitlements: EntitlementsRecord, audit: AuditEvent): Promise<boolean>;
  adoptLegacyBranch(branch: BranchRecord, entitlements: EntitlementsRecord, audit: AuditEvent): Promise<boolean>;
  getClinic(slug: string): Promise<ClinicRecord | null>;
  getStaff(slug: string, username: string): Promise<StaffRecord | null>;
  listStaff(slug: string, after: string | null): Promise<Page<StaffRecord>>;
  getEntitlements(slug: string): Promise<EntitlementsRecord | null>;
  createStaff(staff: StaffRecord, audit: AuditEvent): Promise<boolean>;
  replaceStaff(staff: StaffRecord, expectedVersion: number, requireInactiveClinic: boolean, audit: AuditEvent): Promise<boolean>;
  replaceEntitlements(record: EntitlementsRecord, expectedVersion: number, audit: AuditEvent): Promise<boolean>;
  setClinicState(clinic: ClinicRecord, expectedVersion: number, adminUsername: string | null, audit: AuditEvent): Promise<boolean>;
}
export interface StaffIdentity { lookup(cognitoUsername: string): Promise<{ sub: string } | null> }
export interface HttpInput {
  method: string; path: string; queryString?: string; headers: Record<string, string | undefined>;
  body?: string; isBase64Encoded?: boolean;
  // Only the API Gateway JWT authorizer adapter may populate these claims.
  verifiedJwtClaims?: Record<string, unknown>;
}
export interface HttpResult { statusCode: number; headers: Record<string, string>; body: string }
export interface AppConfig {
  publicOrigin: string; operatorIssuer: string; operatorClientId: string;
  allowedOperatorSubs: ReadonlySet<string>; cursorSigningKey: string; now?: () => Date;
}

const RESERVED = new Set(['admin', 'api', 'app', 'control', 'controlpanel', 'staging', 'www']);
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const USERNAME = /^[a-z0-9._@+-]{3,128}$/;
const COGNITO_USERNAME = /^[A-Za-z0-9._@+-]{3,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRole = (value: unknown): value is Role => typeof value === 'string' && ROLES.some((role) => role === value);
const validSlug = (value: string): boolean => value.length <= 63 && SLUG.test(value) && !RESERVED.has(value);
const validUsername = (value: string): boolean => USERNAME.test(value);

function respond(statusCode: number, value: unknown): HttpResult {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    },
    body: JSON.stringify(value),
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOnly(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= max && !/[\u0000-\u001f\u007f]/.test(clean) ? clean : null;
}
function version(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 1 && value < 1_000_000_000;
}
function body(input: HttpInput): Record<string, unknown> | null {
  if (input.isBase64Encoded || !input.headers['content-type']?.toLowerCase().startsWith('application/json') ||
      !input.body || input.body.length > 8192) return null;
  try { const parsed: unknown = JSON.parse(input.body); return object(parsed) ? parsed : null; }
  catch { return null; }
}
function entitlements(value: unknown): Entitlements | null {
  if (!object(value) || !hasOnly(value, [...MODULES])) return null;
  for (const module of MODULES) if (typeof value[module] !== 'boolean') return null;
  return value as Entitlements;
}
function noModules(): Entitlements {
  return Object.fromEntries(MODULES.map((module) => [module, false])) as Entitlements;
}
function validModules(modules: Entitlements): boolean {
  // Existing records can be used after intake/booking is disabled. Pharmacy's billing route
  // checks consultations separately, while a consultation fee can still be billed alone.
  return (!modules.vitals || modules.consultations) &&
    (!modules.prescriptions || modules.consultations);
}
function nameKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
function query(input: HttpInput, keys: string[]): Record<string, string> | null {
  const params = new URLSearchParams(input.queryString ?? '');
  if ([...params.keys()].some((key) => !keys.includes(key) || params.getAll(key).length !== 1)) return null;
  return Object.fromEntries(params);
}
function signCursor(config: AppConfig, scope: string, filter: string, lastKey: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, scope, filter, lastKey })).toString('base64url');
  const mac = createHmac('sha256', config.cursorSigningKey).update(`control-cursor-v1:${payload}`).digest('base64url');
  return `${payload}.${mac}`;
}
function readCursor(config: AppConfig, cursor: string | undefined, scope: string, filter: string): string | null | undefined {
  if (cursor === undefined) return null;
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  const [payload, mac] = cursor.split('.');
  const expected = createHmac('sha256', config.cursorSigningKey).update(`control-cursor-v1:${payload}`).digest();
  const actual = Buffer.from(mac, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return object(decoded) && decoded.v === 1 && decoded.scope === scope && decoded.filter === filter &&
      typeof decoded.lastKey === 'string' && decoded.lastKey.length > 0 && decoded.lastKey.length <= 256
      ? decoded.lastKey : undefined;
  } catch { return undefined; }
}
function publicStaff(staff: StaffRecord) {
  return { clinicSlug: staff.clinicSlug, username: staff.username, displayName: staff.displayName,
    role: staff.role, active: staff.active, version: staff.version };
}
function matchesBranch(clinic: ClinicRecord, indexed: BranchRecord | null): boolean {
  return indexed !== null && indexed.slug === clinic.slug && indexed.customerId === clinic.customerId &&
    indexed.branchName === clinic.branchName && indexed.displayName === clinic.displayName &&
    indexed.active === clinic.active && indexed.version === clinic.version;
}

export function createControlApp(repo: ControlRepository, identity: StaffIdentity, config: AppConfig) {
  const origin = new URL(config.publicOrigin);
  const issuer = new URL(config.operatorIssuer);
  if (origin.protocol !== 'https:' || origin.origin !== config.publicOrigin ||
      issuer.protocol !== 'https:' || issuer.href !== config.operatorIssuer ||
      !config.operatorClientId || config.allowedOperatorSubs.size === 0 ||
      config.cursorSigningKey.length < 32) {
    throw new Error('Invalid Control Panel configuration');
  }
  const now = config.now ?? (() => new Date());
  const audit = (actorSub: string, slug: string, action: string, target: string,
    changes: AuditEvent['changes']): AuditEvent => ({
    id: randomUUID(), clinicSlug: slug, actorSub, action, target, at: now().toISOString(), changes,
  });
  const paged = <T>(scope: string, filter: string, page: Page<T>) => ({
    items: page.items,
    nextCursor: page.nextKey ? signCursor(config, scope, filter, page.nextKey) : null,
  });

  return {
    async handle(input: HttpInput): Promise<HttpResult> {
      try {
        // API Gateway must verify the JWT signature, issuer and audience before
        // its authorizer claims reach this adapter. Headers never supply identity.
        const claims = input.verifiedJwtClaims;
        if (!claims || claims.token_use !== 'access' || claims.iss !== config.operatorIssuer ||
            claims.client_id !== config.operatorClientId || typeof claims.sub !== 'string' ||
            !config.allowedOperatorSubs.has(claims.sub)) return respond(403, { error: 'Operator access denied' });
        const actor = claims.sub;
        if (input.headers.origin && input.headers.origin !== config.publicOrigin) return respond(403, { error: 'Origin rejected' });
        if (input.method !== 'GET' && input.headers.origin !== config.publicOrigin) return respond(403, { error: 'Origin rejected' });

        if (input.method === 'POST' && input.path === '/api/control/customers') {
          const request = body(input);
          if (!request || !hasOnly(request, ['displayName']) || !text(request.displayName, 120)) {
            return respond(400, { error: 'Invalid customer' });
          }
          const customer: CustomerRecord = {
            id: randomUUID(), displayName: text(request.displayName, 120)!,
            createdAt: now().toISOString(), version: 1,
          };
          const created = await repo.createCustomer(customer,
            audit(actor, `CUSTOMER#${customer.id}`, 'customer.created', customer.id, { version: 1 }));
          return created ? respond(201, { customer }) : respond(409, { error: 'Customer changed; retry' });
        }
        if (input.method === 'GET' && input.path === '/api/control/customers') {
          const params = query(input, ['prefix', 'cursor']);
          if (!params || (params.prefix !== undefined && params.prefix.length > 80)) return respond(400, { error: 'Invalid search' });
          const prefix = nameKey(params.prefix ?? '');
          if (prefix && !text(prefix, 80)) return respond(400, { error: 'Invalid search' });
          const after = readCursor(config, params.cursor, 'customers', prefix);
          if (after === undefined) return respond(400, { error: 'Invalid cursor' });
          return respond(200, paged('customers', prefix, await repo.listCustomers(prefix, after)));
        }
        if (input.method === 'GET' && input.path === '/api/control/branches') {
          const params = query(input, ['prefix', 'cursor']);
          const prefix = params?.prefix ?? '';
          if (!params || prefix.length > 63 || !/^[a-z0-9-]*$/.test(prefix)) return respond(400, { error: 'Invalid search' });
          const after = readCursor(config, params.cursor, 'branches', prefix);
          if (after === undefined) return respond(400, { error: 'Invalid cursor' });
          return respond(200, paged('branches', prefix, await repo.listBranches(prefix, after)));
        }
        const customerRoute = /^\/api\/control\/customers\/([0-9a-f-]+)(?:\/branches(?:\/([a-z0-9-]+))?)?$/.exec(input.path);
        if (customerRoute && UUID.test(customerRoute[1])) {
          const customerId = customerRoute[1];
          const customer = await repo.getCustomer(customerId);
          if (!customer) return respond(404, { error: 'Customer not found' });
          if (!input.path.includes('/branches')) {
            return input.method === 'GET' ? respond(200, { customer }) : respond(404, { error: 'Not found' });
          }
          const branchSlug = customerRoute[2];
          if (branchSlug && validSlug(branchSlug) && input.method === 'GET') {
            const clinic = await repo.getClinic(branchSlug);
            if (!clinic || clinic.customerId !== customerId || !clinic.branchName) return respond(404, { error: 'Branch not found' });
            const indexed = await repo.getCustomerBranch(customerId, nameKey(clinic.branchName));
            if (!matchesBranch(clinic, indexed)) throw new Error('Broken branch index');
            const modules = await repo.getEntitlements(branchSlug);
            if (!modules) throw new Error('Missing entitlements');
            return respond(200, { branch: clinic as BranchRecord, entitlements: modules });
          }
          if (branchSlug === 'adopt' && input.method === 'POST') {
            const request = body(input);
            if (!request || !hasOnly(request, ['slug', 'branchName', 'expectedDisplayName', 'expectedActive',
              'expectedClinicVersion', 'expectedEntitlementsVersion', 'expectedModules']) ||
                typeof request.slug !== 'string' || !validSlug(request.slug) ||
                !text(request.branchName, 120) || !text(request.expectedDisplayName, 120) ||
                typeof request.expectedActive !== 'boolean' || !version(request.expectedClinicVersion) ||
                !version(request.expectedEntitlementsVersion) || !entitlements(request.expectedModules)) {
              return respond(400, { error: 'Invalid legacy branch snapshot' });
            }
            const legacy = await repo.getClinic(request.slug);
            const existingModules = await repo.getEntitlements(request.slug);
            if (!legacy || legacy.customerId || !existingModules ||
                legacy.displayName !== request.expectedDisplayName || legacy.active !== request.expectedActive ||
                legacy.version !== request.expectedClinicVersion ||
                existingModules.version !== request.expectedEntitlementsVersion ||
                MODULES.some((name) => existingModules.modules[name] !== (request.expectedModules as Entitlements)[name])) {
              return respond(409, { error: 'Legacy clinic changed; review and retry' });
            }
            const branch: BranchRecord = { ...legacy, customerId, branchName: text(request.branchName, 120)! };
            const applied = await repo.adoptLegacyBranch(branch, existingModules,
              audit(actor, branch.slug, 'branch.legacy_adopted', branch.slug,
                { customerId, active: branch.active, version: branch.version }));
            return applied ? respond(200, { branch, entitlements: existingModules })
              : respond(409, { error: 'Legacy clinic or branch name changed; review and retry' });
          }
          if (!branchSlug && input.method === 'GET') {
            const params = query(input, ['cursor']);
            if (!params) return respond(400, { error: 'Invalid search' });
            const after = readCursor(config, params.cursor, `customer-branches:${customerId}`, '');
            if (after === undefined) return respond(400, { error: 'Invalid cursor' });
            return respond(200, paged(`customer-branches:${customerId}`, '', await repo.listCustomerBranches(customerId, after)));
          }
          if (!branchSlug && input.method === 'POST') {
            const request = body(input);
            const branchName = request && text(request.branchName, 120);
            const displayName = request && text(request.displayName, 120);
            if (!request || !hasOnly(request, ['slug', 'branchName', 'displayName']) ||
                typeof request.slug !== 'string' || !validSlug(request.slug) || !branchName || !displayName) {
              return respond(400, { error: 'Invalid branch' });
            }
            const branch: BranchRecord = { slug: request.slug, customerId, branchName,
              displayName, active: false, version: 1 };
            const modules: EntitlementsRecord = { clinicSlug: branch.slug, modules: noModules(), version: 1 };
            const created = await repo.createBranch(branch, modules,
              audit(actor, branch.slug, 'branch.created', branch.slug, { customerId, active: false }));
            return created ? respond(201, { branch, entitlements: modules })
              : respond(409, { error: 'Branch name or slug already exists' });
          }
          return respond(404, { error: 'Not found' });
        }
        const globalBranchRoute = /^\/api\/control\/branches\/([a-z0-9-]+)$/.exec(input.path);
        if (globalBranchRoute && validSlug(globalBranchRoute[1]) && input.method === 'GET') {
          const branch = await repo.getClinic(globalBranchRoute[1]);
          if (!branch?.customerId || !branch.branchName) return respond(404, { error: 'Branch not found' });
          const indexed = await repo.getCustomerBranch(branch.customerId, nameKey(branch.branchName));
          if (!matchesBranch(branch, indexed)) throw new Error('Broken branch index');
          const modules = await repo.getEntitlements(branch.slug);
          if (!modules) throw new Error('Missing entitlements');
          return respond(200, { branch, entitlements: modules });
        }

        const route = /^\/api\/control\/clinics\/([a-z0-9-]+)(?:\/(staff(?:\/([a-z0-9._@+-]+))?|modules|state))?$/.exec(input.path);
        if (!route || !validSlug(route[1])) return respond(404, { error: 'Not found' });
        const slug = route[1];
        const endpoint = route[2] ?? '';
        const username = route[3];
        const clinic = await repo.getClinic(slug);
        if (!clinic) return respond(404, { error: 'Clinic not found' });

        if (input.method === 'GET' && endpoint === '') {
          const modules = await repo.getEntitlements(slug);
          if (!modules) throw new Error('Missing entitlements');
          return respond(200, { clinic, entitlements: modules });
        }
        if (input.method === 'GET' && endpoint === 'staff') {
          const params = query(input, ['cursor']);
          if (!params) return respond(400, { error: 'Invalid search' });
          const after = readCursor(config, params.cursor, `staff:${slug}`, '');
          if (after === undefined) return respond(400, { error: 'Invalid cursor' });
          const page = await repo.listStaff(slug, after);
          return respond(200, paged(`staff:${slug}`, '', {
            items: page.items.map(publicStaff), nextKey: page.nextKey,
          }));
        }
        if (input.method === 'GET' && endpoint === `staff/${username}` && username && validUsername(username)) {
          const staff = await repo.getStaff(slug, username);
          return staff ? respond(200, { staff: publicStaff(staff) }) : respond(404, { error: 'Staff not found' });
        }
        if (input.method === 'POST' && endpoint === 'staff') {
          const request = body(input);
          if (!request || !hasOnly(request, ['username', 'cognitoUsername', 'displayName', 'role']) ||
              typeof request.username !== 'string' || !validUsername(request.username) ||
              typeof request.cognitoUsername !== 'string' || !COGNITO_USERNAME.test(request.cognitoUsername) ||
              !text(request.displayName, 120) || !isRole(request.role)) return respond(400, { error: 'Invalid staff member' });
          const found = await identity.lookup(request.cognitoUsername);
          if (!found || !found.sub) return respond(409, { error: 'Staff identity is not active and confirmed' });
          const staff: StaffRecord = {
            clinicSlug: slug, username: request.username, cognitoUsername: request.cognitoUsername,
            sub: found.sub, displayName: text(request.displayName, 120)!, role: request.role,
            active: true, version: 1,
          };
          const created = await repo.createStaff(staff, audit(actor, slug, 'staff.created', staff.username,
            { role: staff.role, active: true }));
          return created ? respond(201, { staff: publicStaff(staff) }) : respond(409, { error: 'Staff already exists or clinic changed' });
        }
        if (input.method === 'PATCH' && endpoint === `staff/${username}` && username && validUsername(username)) {
          const request = body(input);
          if (!request || !hasOnly(request, ['expectedVersion', 'displayName', 'role', 'active']) ||
              !version(request.expectedVersion) || !text(request.displayName, 120) ||
              !isRole(request.role) || typeof request.active !== 'boolean') return respond(400, { error: 'Invalid staff change' });
          const previous = await repo.getStaff(slug, username);
          if (!previous) return respond(404, { error: 'Staff not found' });
          if (previous.version !== request.expectedVersion) return respond(409, { error: 'Staff changed; refresh and retry' });
          const updated: StaffRecord = { ...previous, displayName: text(request.displayName, 120)!,
            role: request.role, active: request.active, version: previous.version + 1 };
          const removingActiveAdmin = previous.active && previous.role === 'clinic_admin' &&
            (!updated.active || updated.role !== 'clinic_admin');
          if (removingActiveAdmin && clinic.active) return respond(409, { error: 'Disable clinic before changing an active clinic admin' });
          const applied = await repo.replaceStaff(updated, previous.version, removingActiveAdmin, audit(actor, slug, 'staff.updated', username,
            { role: updated.role, active: updated.active, version: updated.version }));
          return applied ? respond(200, { staff: publicStaff(updated) }) : respond(409, { error: 'Staff changed; refresh and retry' });
        }
        if (input.method === 'PUT' && endpoint === 'modules') {
          const request = body(input);
          if (!request || !hasOnly(request, ['expectedVersion', 'modules']) ||
              !version(request.expectedVersion) || !entitlements(request.modules) ||
              !validModules(entitlements(request.modules)!)) return respond(400, { error: 'Invalid entitlements' });
          const previous = await repo.getEntitlements(slug);
          if (!previous) throw new Error('Missing entitlements');
          if (previous.version !== request.expectedVersion) return respond(409, { error: 'Entitlements changed; refresh and retry' });
          const updated: EntitlementsRecord = { clinicSlug: slug, modules: entitlements(request.modules)!, version: previous.version + 1 };
          const applied = await repo.replaceEntitlements(updated, previous.version,
            audit(actor, slug, 'modules.replaced', slug, { version: updated.version }));
          return applied ? respond(200, { entitlements: updated }) : respond(409, { error: 'Entitlements changed; refresh and retry' });
        }
        if (input.method === 'PATCH' && endpoint === 'state') {
          const request = body(input);
          if (!request || !hasOnly(request, ['expectedVersion', 'active', 'adminUsername']) ||
              !version(request.expectedVersion) || typeof request.active !== 'boolean' ||
              (request.adminUsername !== null && (typeof request.adminUsername !== 'string' || !validUsername(request.adminUsername)))) {
            return respond(400, { error: 'Invalid clinic state' });
          }
          if (clinic.version !== request.expectedVersion) return respond(409, { error: 'Clinic changed; refresh and retry' });
          const adminUsername = request.active ? request.adminUsername as string | null : null;
          if (request.active) {
            if (!adminUsername) return respond(400, { error: 'Active clinic admin required' });
            const admin = await repo.getStaff(slug, adminUsername);
            if (!admin?.active || admin.role !== 'clinic_admin') return respond(409, { error: 'Active clinic admin required' });
          }
          const updated: ClinicRecord = { ...clinic, active: request.active, version: clinic.version + 1 };
          const applied = await repo.setClinicState(updated, clinic.version, adminUsername,
            audit(actor, slug, 'clinic.state_changed', slug, { active: updated.active, version: updated.version }));
          return applied ? respond(200, { clinic: updated }) : respond(409, { error: 'Clinic changed; refresh and retry' });
        }
        return respond(404, { error: 'Not found' });
      } catch {
        // Never serialize AWS errors, user records or access tokens to the caller.
        return respond(503, { error: 'Control Panel temporarily unavailable' });
      }
    },
  };
}
