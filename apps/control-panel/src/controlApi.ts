export const MODULES = ['patient_intake', 'appointments', 'vitals', 'consultations', 'prescriptions', 'lab_reports', 'billing', 'email_notifications'] as const;
export type Module = typeof MODULES[number];
export type Modules = Record<Module, boolean>;
export const ROLES = ['clinic_admin', 'doctor', 'receptionist', 'nurse', 'lab_tech', 'billing', 'pharmacist'] as const;
export type Role = typeof ROLES[number];

export interface Customer { id: string; displayName: string; createdAt: string; version: number }
export interface Branch { slug: string; customerId: string; branchName: string; displayName: string; active: boolean; version: number }
export interface Clinic { slug: string; customerId?: string; branchName?: string; displayName: string; active: boolean; version: number }
export interface Entitlements { clinicSlug: string; modules: Modules; version: number }
export interface Staff { clinicSlug: string; username: string; displayName: string; role: Role; active: boolean; version: number }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface BranchDiagnostics {
  branch: Branch;
  checkedAt: string;
  configuration: {
    entitlements: { state: 'present' | 'missing'; version: number | null; enabledModules: Module[] };
    staff: { sampledCount: number; hasMore: boolean; activeAdmin: 'present' | 'missing' | 'unknown' };
  };
  recentChanges: { from: string; to: string; items: { id: string; at: string; action: string }[]; hasMore: boolean };
  telemetry: {
    clinicAuth: { state: 'not_instrumented' };
    clinicWorkflow: { state: 'not_instrumented' };
    emailDelivery: { state: 'not_instrumented' };
  };
}

export class ControlApiError extends Error {
  readonly status: number | null;
  constructor(status: number | null, message: string) { super(message); this.name = 'ControlApiError'; this.status = status; }
}

type Dict = Record<string, unknown>;
const record = (v: unknown): v is Dict => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const nonnegativeInteger = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const iso = (v: unknown): v is string => text(v, 64) && Number.isFinite(Date.parse(v));
const stringOrNull = (v: unknown): v is string | null => v === null || text(v, 2048);

function parseCustomer(value: unknown): Customer {
  if (!record(value) || !text(value.id, 128) || !text(value.displayName, 120) || !iso(value.createdAt) || !integer(value.version)) throw invalid();
  return { id: value.id, displayName: value.displayName, createdAt: value.createdAt, version: value.version };
}
function parseBranch(value: unknown): Branch {
  if (!record(value) || !text(value.slug, 63) || !text(value.customerId, 128) || !text(value.branchName, 120) ||
    !text(value.displayName, 120) || typeof value.active !== 'boolean' || !integer(value.version)) throw invalid();
  return { slug: value.slug, customerId: value.customerId, branchName: value.branchName, displayName: value.displayName, active: value.active, version: value.version };
}
function parseClinic(value: unknown): Clinic {
  if (!record(value) || !text(value.slug, 63) || !text(value.displayName, 120) ||
    typeof value.active !== 'boolean' || !integer(value.version) ||
    (value.customerId !== undefined && !text(value.customerId, 128)) ||
    (value.branchName !== undefined && !text(value.branchName, 120))) throw invalid();
  return {
    slug: value.slug, displayName: value.displayName, active: value.active, version: value.version,
    ...(value.customerId === undefined ? {} : { customerId: value.customerId as string }),
    ...(value.branchName === undefined ? {} : { branchName: value.branchName as string }),
  };
}
function parseEntitlements(value: unknown): Entitlements {
  if (!record(value) || !text(value.clinicSlug, 63) || !integer(value.version) || !record(value.modules) ||
    MODULES.some((name) => typeof (value.modules as Dict)[name] !== 'boolean')) throw invalid();
  return { clinicSlug: value.clinicSlug, version: value.version, modules: Object.fromEntries(MODULES.map((name) => [name, (value.modules as Dict)[name]])) as Modules };
}
function parseStaff(value: unknown): Staff {
  if (!record(value) || !text(value.clinicSlug, 63) || !text(value.username, 128) || !text(value.displayName, 120) ||
    !ROLES.includes(value.role as Role) || typeof value.active !== 'boolean' || !integer(value.version)) throw invalid();
  return { clinicSlug: value.clinicSlug, username: value.username, displayName: value.displayName, role: value.role as Role, active: value.active, version: value.version };
}
function parsePage<T>(value: unknown, parse: (item: unknown) => T): Page<T> {
  if (!record(value) || !Array.isArray(value.items) || !stringOrNull(value.nextCursor) || value.items.length > 100) throw invalid();
  return { items: value.items.map(parse), nextCursor: value.nextCursor };
}
function parseBranchDiagnostics(value: unknown): BranchDiagnostics {
  if (!record(value) || !iso(value.checkedAt) || !record(value.configuration) ||
      !record(value.configuration.entitlements) || !record(value.configuration.staff) ||
      !record(value.recentChanges) || !record(value.telemetry)) throw invalid();
  const entitlements = value.configuration.entitlements;
  const staff = value.configuration.staff;
  const changes = value.recentChanges;
  const telemetry = value.telemetry;
  if (!['present', 'missing'].includes(entitlements.state as string) ||
      !(entitlements.version === null || integer(entitlements.version)) ||
      !Array.isArray(entitlements.enabledModules) || entitlements.enabledModules.length > MODULES.length ||
      entitlements.enabledModules.some((item) => !MODULES.includes(item as Module)) ||
      new Set(entitlements.enabledModules).size !== entitlements.enabledModules.length ||
      (entitlements.state === 'missing' && (entitlements.version !== null || entitlements.enabledModules.length !== 0)) ||
      (entitlements.state === 'present' && entitlements.version === null) ||
      !nonnegativeInteger(staff.sampledCount) || staff.sampledCount > 20 || typeof staff.hasMore !== 'boolean' ||
      !['present', 'missing', 'unknown'].includes(staff.activeAdmin as string) ||
      (staff.hasMore && staff.activeAdmin === 'missing') ||
      !iso(changes.from) || !iso(changes.to) || Date.parse(changes.from) > Date.parse(changes.to) ||
      !Array.isArray(changes.items) || changes.items.length > 20 || typeof changes.hasMore !== 'boolean' ||
      [telemetry.clinicAuth, telemetry.clinicWorkflow, telemetry.emailDelivery].some((item) =>
        !record(item) || item.state !== 'not_instrumented')) throw invalid();
  const items = changes.items.map((item: unknown) => {
    if (!record(item) || !text(item.id, 128) || !iso(item.at) || !text(item.action, 80) ||
        Date.parse(item.at) < Date.parse(changes.from as string) || Date.parse(item.at) > Date.parse(changes.to as string)) throw invalid();
    return { id: item.id, at: item.at, action: item.action };
  });
  return {
    branch: parseBranch(value.branch), checkedAt: value.checkedAt,
    configuration: {
      entitlements: { state: entitlements.state as 'present' | 'missing',
        version: entitlements.version as number | null, enabledModules: entitlements.enabledModules as Module[] },
      staff: { sampledCount: staff.sampledCount, hasMore: staff.hasMore,
        activeAdmin: staff.activeAdmin as 'present' | 'missing' | 'unknown' },
    },
    recentChanges: { from: changes.from, to: changes.to, items, hasMore: changes.hasMore },
    telemetry: { clinicAuth: { state: 'not_instrumented' },
      clinicWorkflow: { state: 'not_instrumented' }, emailDelivery: { state: 'not_instrumented' } },
  };
}
function invalid(): ControlApiError { return new ControlApiError(null, 'The Control Panel received an invalid response.'); }

export function safeError(error: unknown): string {
  if (!(error instanceof ControlApiError)) return 'The Control Panel is unavailable. Please try again.';
  if (error.status === 400) return 'Some details are invalid. Review the fields and try again.';
  if (error.status === 404) return 'This record was not found. Refresh the list.';
  if (error.status === 409) return 'This record changed or conflicts with an existing one. Refresh and review before trying again.';
  if (error.status === 429) return 'Too many requests. Please wait and try again.';
  return 'The Control Panel is unavailable. Please try again.';
}

export class ControlApi {
  private readonly accessToken: () => string | null;
  constructor(accessToken: () => string | null) { this.accessToken = accessToken; }

  private async request(method: string, path: string, payload?: unknown): Promise<unknown> {
    const token = this.accessToken();
    if (!token) throw new ControlApiError(401, 'Operator sign-in required');
    let response: Response;
    try {
      response = await fetch(`/api/control${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch { throw new ControlApiError(null, 'Control API unavailable'); }
    const jsonResponse = response.headers.get('content-type')?.toLowerCase().includes('application/json');
    if ((response.status === 401 || response.status === 403) && jsonResponse) throw new ControlApiError(response.status, 'Operator access denied');
    if ((response.status === 401 || response.status === 403) && !jsonResponse) throw new ControlApiError(null, 'Control API unavailable');
    if (!response.ok) throw new ControlApiError(response.status, 'Control request failed');
    if (!jsonResponse) throw invalid();
    try { return await response.json(); } catch { throw invalid(); }
  }

  async customers(prefix = '', cursor?: string): Promise<Page<Customer>> {
    const query = new URLSearchParams();
    if (prefix) query.set('prefix', prefix);
    if (cursor) query.set('cursor', cursor);
    return parsePage(await this.request('GET', `/customers?${query}`), parseCustomer);
  }
  async customer(id: string): Promise<Customer> {
    const value = await this.request('GET', `/customers/${encodeURIComponent(id)}`);
    if (!record(value)) throw invalid();
    return parseCustomer(value.customer);
  }
  async createCustomer(displayName: string): Promise<Customer> {
    const value = await this.request('POST', '/customers', { displayName });
    if (!record(value)) throw invalid();
    return parseCustomer(value.customer);
  }
  async branches(customerId: string, cursor?: string): Promise<Page<Branch>> {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    return parsePage(await this.request('GET', `/customers/${encodeURIComponent(customerId)}/branches?${query}`), parseBranch);
  }
  async branchDirectory(prefix = '', cursor?: string): Promise<Page<Branch>> {
    const query = new URLSearchParams();
    if (prefix) query.set('prefix', prefix);
    if (cursor) query.set('cursor', cursor);
    const page = parsePage(await this.request('GET', `/branches?${query}`), parseBranch);
    if (page.items.length > 20) throw invalid();
    return page;
  }
  async createBranch(customerId: string, input: { slug: string; branchName: string; displayName: string }): Promise<{ branch: Branch; entitlements: Entitlements }> {
    const value = await this.request('POST', `/customers/${encodeURIComponent(customerId)}/branches`, input);
    if (!record(value)) throw invalid();
    return { branch: parseBranch(value.branch), entitlements: parseEntitlements(value.entitlements) };
  }
  async adoptBranch(customerId: string, input: {
    slug: string; branchName: string; expectedDisplayName: string; expectedActive: boolean;
    expectedClinicVersion: number; expectedEntitlementsVersion: number; expectedModules: Modules;
  }): Promise<{ branch: Branch; entitlements: Entitlements }> {
    const value = await this.request('POST', `/customers/${encodeURIComponent(customerId)}/branches/adopt`, input);
    if (!record(value)) throw invalid();
    return { branch: parseBranch(value.branch), entitlements: parseEntitlements(value.entitlements) };
  }
  async branch(customerId: string, slug: string): Promise<{ branch: Branch; entitlements: Entitlements }> {
    const value = await this.request('GET', `/customers/${encodeURIComponent(customerId)}/branches/${encodeURIComponent(slug)}`);
    if (!record(value)) throw invalid();
    return { branch: parseBranch(value.branch), entitlements: parseEntitlements(value.entitlements) };
  }
  async diagnostics(slug: string): Promise<BranchDiagnostics> {
    const result = parseBranchDiagnostics(await this.request('GET', `/branches/${encodeURIComponent(slug)}/diagnostics`));
    if (result.branch.slug !== slug) throw invalid();
    return result;
  }
  async clinic(slug: string): Promise<{ clinic: Clinic; entitlements: Entitlements }> {
    const value = await this.request('GET', `/clinics/${encodeURIComponent(slug)}`);
    if (!record(value)) throw invalid();
    return { clinic: parseClinic(value.clinic), entitlements: parseEntitlements(value.entitlements) };
  }
  async staff(slug: string, username: string): Promise<Staff> {
    const value = await this.request('GET', `/clinics/${encodeURIComponent(slug)}/staff/${encodeURIComponent(username)}`);
    if (!record(value)) throw invalid();
    return parseStaff(value.staff);
  }
  async staffPage(slug: string, cursor?: string): Promise<Page<Staff>> {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    return parsePage(await this.request('GET', `/clinics/${encodeURIComponent(slug)}/staff?${query}`), parseStaff);
  }
  async createStaff(slug: string, input: { username: string; cognitoUsername: string; displayName: string; role: Role }): Promise<Staff> {
    const value = await this.request('POST', `/clinics/${encodeURIComponent(slug)}/staff`, input);
    if (!record(value)) throw invalid();
    return parseStaff(value.staff);
  }
  async updateStaff(slug: string, username: string, input: { expectedVersion: number; displayName: string; role: Role; active: boolean }): Promise<Staff> {
    const value = await this.request('PATCH', `/clinics/${encodeURIComponent(slug)}/staff/${encodeURIComponent(username)}`, input);
    if (!record(value)) throw invalid();
    return parseStaff(value.staff);
  }
  async setModules(slug: string, expectedVersion: number, modules: Modules): Promise<Entitlements> {
    const value = await this.request('PUT', `/clinics/${encodeURIComponent(slug)}/modules`, { expectedVersion, modules });
    if (!record(value)) throw invalid();
    return parseEntitlements(value.entitlements);
  }
  async setState(slug: string, expectedVersion: number, active: boolean, adminUsername: string | null): Promise<Branch> {
    const value = await this.request('PATCH', `/clinics/${encodeURIComponent(slug)}/state`, { expectedVersion, active, adminUsername });
    if (!record(value)) throw invalid();
    return parseBranch(value.clinic);
  }
}
