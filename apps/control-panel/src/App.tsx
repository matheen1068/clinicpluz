import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ControlApi, ControlApiError, MODULES, ROLES, safeError,
  type Branch, type Clinic, type Customer, type Entitlements, type Modules, type Role, type Staff,
} from './controlApi';
import { completeSignIn, configFromEnv, managedSignOut, startSignIn, type AccessSession } from './oauth';

const authConfig = configFromEnv({
  VITE_OPERATOR_AUTH_DOMAIN: import.meta.env.VITE_OPERATOR_AUTH_DOMAIN,
  VITE_OPERATOR_CLIENT_ID: import.meta.env.VITE_OPERATOR_CLIENT_ID,
  VITE_OPERATOR_REDIRECT_URI: import.meta.env.VITE_OPERATOR_REDIRECT_URI,
  VITE_OPERATOR_LOGOUT_URI: import.meta.env.VITE_OPERATOR_LOGOUT_URI,
}, window.location);
let callbackPromise: Promise<AccessSession | null> | null = null;

const moduleLabels: Record<(typeof MODULES)[number], string> = {
  patient_intake: 'Patient intake', appointments: 'Appointments', vitals: 'Vitals', consultations: 'Consultations',
  prescriptions: 'Prescriptions', lab_reports: 'Lab reports', billing: 'Billing', email_notifications: 'Email notifications',
};
const enforcedModules = new Set<string>(['patient_intake', 'appointments', 'consultations', 'billing']);
const roleLabels: Record<Role, string> = {
  clinic_admin: 'Clinic admin', doctor: 'Doctor', receptionist: 'Receptionist', nurse: 'Nurse',
  lab_tech: 'Lab technician', billing: 'Billing staff', pharmacist: 'Pharmacist',
};

type AuthStage = 'checking' | 'configuration' | 'signed-out' | 'ready' | 'denied' | 'error';
type Tab = 'overview' | 'team' | 'modules' | 'operations';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date) : 'Date unavailable';
}
function initials(value: string): string { return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''); }
function Status({ active }: { active: boolean }) { return <span className={`status ${active ? 'status--active' : 'status--inactive'}`}>{active ? 'Active' : 'Inactive'}</span>; }
function Banner({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'error' | 'success' }) {
  return <div className={`banner banner--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}
function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="empty"><span className="empty-symbol" aria-hidden="true">✧</span><h3>{title}</h3><p>{children}</p></div>;
}

function OperatorGate({ stage, message, onSignIn, onSignOut }: { stage: AuthStage; message: string; onSignIn: () => void; onSignOut: () => void }) {
  const copy: Record<AuthStage, { eyebrow: string; title: string; body: string }> = {
    checking: { eyebrow: 'Checking access', title: 'Preparing your workspace', body: 'Verifying the platform sign-in response.' },
    configuration: { eyebrow: 'Setup required', title: 'Operator sign-in is not configured', body: 'The platform identity domain, client and approved callback URLs must be configured before this app can open.' },
    'signed-out': { eyebrow: 'Platform access', title: 'A clear view of every clinic', body: 'Sign in with your individual platform operator account. Clinic staff accounts cannot open this workspace.' },
    ready: { eyebrow: 'Platform access', title: 'Opening your workspace', body: 'Loading customer and branch records.' },
    denied: { eyebrow: 'Access denied', title: 'This account is not allowed here', body: 'Your platform account must be on the operator allowlist. Contact your platform administrator.' },
    error: { eyebrow: 'Sign-in interrupted', title: 'We could not complete sign-in', body: message || 'Please try again.' },
  };
  const item = copy[stage];
  return <div className="gate-layout"><aside className="gate-story"><div className="brand brand--light"><span className="brand-mark">✳</span><span>Clinic<span>Pluz</span></span></div><div className="gate-story-copy"><span className="overline overline--light">PLATFORM OPERATIONS</span><h1>Every branch,<br />in focus.</h1><p>One calm workspace to set up customers, guide branch onboarding and manage clinic access.</p></div><div className="gate-story-footer">Control Panel · Platform team only</div></aside><main className="gate-main"><div className="gate-top">CONTROL PANEL <span>V1 / SYNTHETIC STAGING</span></div><div className="gate-card"><div className="gate-icon" aria-hidden="true">↗</div><span className="overline">{item.eyebrow}</span><h2>{item.title}</h2><p>{item.body}</p>{stage === 'error' && message && <Banner tone="error">{message}</Banner>}{(stage === 'signed-out' || stage === 'error') && <button className="button button--primary gate-button" type="button" onClick={onSignIn}>Sign in with platform account <span aria-hidden="true">→</span></button>}{stage === 'denied' && <button className="button button--soft gate-button" type="button" onClick={onSignOut}>Sign out and switch account</button>}{stage === 'configuration' && <p className="quiet-note">No clinic or operator data is shown without a configured identity service.</p>}{stage === 'checking' && <div className="loading-line" aria-label="Loading" />}</div><div className="gate-foot">Separate from the Clinic App · No patient or clinical records</div></main></div>;
}

function Workspace({ session, onAccessLost, onSignOut }: { session: AccessSession; onAccessLost: (status: number) => void; onSignOut: () => void }) {
  const api = useMemo(() => new ControlApi(() => Date.now() < session.expiresAt - 10_000 ? session.accessToken : null), [session]);
  const customerListSeq = useRef(0);
  const customerContextSeq = useRef(0);
  const branchListSeq = useRef(0);
  const branchDetailSeq = useRef(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerCursor, setCustomerCursor] = useState<string | null>(null);
  const [customerPrefix, setCustomerPrefix] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerBusy, setCustomerBusy] = useState(true);
  const [customerFailed, setCustomerFailed] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchCursor, setBranchCursor] = useState<string | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchFailed, setBranchFailed] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [moduleDraft, setModuleDraft] = useState<Modules | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffCursor, setStaffCursor] = useState<string | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [section, setSection] = useState<'customers' | 'operations'>('customers');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [showAdoptForm, setShowAdoptForm] = useState(false);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchDisplayName, setBranchDisplayName] = useState('');
  const [branchSlug, setBranchSlug] = useState('');
  const [adoptSlug, setAdoptSlug] = useState('');
  const [adoptBranchName, setAdoptBranchName] = useState('');
  const [adoptSnapshot, setAdoptSnapshot] = useState<{ clinic: Clinic; entitlements: Entitlements } | null>(null);
  const [adoptConfirmed, setAdoptConfirmed] = useState(false);
  const [staffUsername, setStaffUsername] = useState('');
  const [staffIdentity, setStaffIdentity] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<Role>('clinic_admin');
  const [editStaffName, setEditStaffName] = useState('');
  const [editStaffRole, setEditStaffRole] = useState<Role>('clinic_admin');
  const [editStaffActive, setEditStaffActive] = useState(true);
  const [adminUsername, setAdminUsername] = useState('');

  function fail(caught: unknown) {
    if (caught instanceof ControlApiError && (caught.status === 401 || caught.status === 403)) {
      onAccessLost(caught.status);
      return;
    }
    setError(safeError(caught));
  }
  async function loadCustomers(prefix = customerPrefix, cursor?: string) {
    const seq = ++customerListSeq.current;
    setCustomerBusy(true); setCustomerFailed(false); setError('');
    try {
      const page = await api.customers(prefix, cursor);
      if (seq !== customerListSeq.current) return;
      setCustomers((old) => cursor ? [...old, ...page.items] : page.items);
      setCustomerCursor(page.nextCursor);
      setCustomerPrefix(prefix);
    } catch (caught) { if (seq === customerListSeq.current) { setCustomerFailed(true); fail(caught); } }
    finally { if (seq === customerListSeq.current) setCustomerBusy(false); }
  }
  useEffect(() => { void loadCustomers('', undefined); }, [api]);

  async function selectCustomer(customer: Customer) {
    if (working) return;
    const seq = ++customerContextSeq.current;
    ++branchListSeq.current; ++branchDetailSeq.current;
    setSelectedCustomer(customer); setSelectedBranch(null); setEntitlements(null); setStaff([]); setDetailBusy(false); setWorking(false);
    setBranches([]); setBranchCursor(null); setBranchBusy(true); setBranchFailed(false); setError(''); setNotice(''); setSection('customers');
    try {
      const page = await api.branches(customer.id);
      if (seq !== customerContextSeq.current) return;
      if (page.items.some((item) => item.customerId !== customer.id)) throw new ControlApiError(null, 'Branch ownership mismatch');
      setBranches(page.items); setBranchCursor(page.nextCursor);
    } catch (caught) { if (seq === customerContextSeq.current) { setBranchFailed(true); fail(caught); } }
    finally { if (seq === customerContextSeq.current) setBranchBusy(false); }
  }
  async function loadMoreBranches() {
    if (!selectedCustomer || !branchCursor) return;
    const seq = ++branchListSeq.current;
    const contextSeq = customerContextSeq.current;
    setBranchBusy(true); setError('');
    try {
      const page = await api.branches(selectedCustomer.id, branchCursor);
      if (seq !== branchListSeq.current || contextSeq !== customerContextSeq.current) return;
      if (page.items.some((item) => item.customerId !== selectedCustomer.id)) throw new ControlApiError(null, 'Branch ownership mismatch');
      setBranches((old) => [...old, ...page.items]); setBranchCursor(page.nextCursor);
    } catch (caught) { if (seq === branchListSeq.current && contextSeq === customerContextSeq.current) fail(caught); }
    finally { if (seq === branchListSeq.current && contextSeq === customerContextSeq.current) setBranchBusy(false); }
  }
  async function selectBranch(branch: Branch) {
    if (!selectedCustomer || working) return;
    const seq = ++branchDetailSeq.current;
    const contextSeq = customerContextSeq.current;
    setSelectedBranch(null); setEntitlements(null); setStaff([]); setStaffCursor(null); setDetailBusy(true); setWorking(false); setError(''); setNotice(''); setTab('overview');
    try {
      const [detail, people] = await Promise.all([api.branch(selectedCustomer.id, branch.slug), api.staffPage(branch.slug)]);
      if (seq !== branchDetailSeq.current || contextSeq !== customerContextSeq.current) return;
      if (detail.branch.customerId !== selectedCustomer.id || detail.branch.slug !== branch.slug ||
        detail.entitlements.clinicSlug !== branch.slug || people.items.some((item) => item.clinicSlug !== branch.slug)) throw new ControlApiError(null, 'Branch context mismatch');
      setSelectedBranch(detail.branch); setEntitlements(detail.entitlements); setModuleDraft(detail.entitlements.modules);
      setStaff(people.items); setStaffCursor(people.nextCursor);
    } catch (caught) { if (seq === branchDetailSeq.current && contextSeq === customerContextSeq.current) fail(caught); }
    finally { if (seq === branchDetailSeq.current && contextSeq === customerContextSeq.current) setDetailBusy(false); }
  }
  async function refreshBranch() {
    if (!selectedBranch || !selectedCustomer) return;
    await selectBranch(selectedBranch);
  }
  async function loadMoreStaff() {
    if (!selectedBranch || !staffCursor) return;
    const seq = branchDetailSeq.current;
    setWorking(true); setError('');
    try {
      const page = await api.staffPage(selectedBranch.slug, staffCursor);
      if (seq !== branchDetailSeq.current) return;
      if (page.items.some((person) => person.clinicSlug !== selectedBranch.slug)) throw new ControlApiError(null, 'Staff context mismatch');
      setStaff((old) => [...old, ...page.items]); setStaffCursor(page.nextCursor);
    } catch (caught) { if (seq === branchDetailSeq.current) fail(caught); }
    finally { if (seq === branchDetailSeq.current) setWorking(false); }
  }
  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); setError(''); setNotice('');
    try {
      const created = await api.createCustomer(customerName.trim());
      setShowCustomerForm(false); setCustomerName(''); setCustomerSearch(''); setCustomerPrefix('');
      await loadCustomers('', undefined);
      await selectCustomer(created);
      setNotice('Customer created. Add its first branch to continue onboarding.');
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }
  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedCustomer) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const created = await api.createBranch(selectedCustomer.id, { slug: branchSlug.trim().toLowerCase(), branchName: branchName.trim(), displayName: branchDisplayName.trim() });
      setShowBranchForm(false); setBranchSlug(''); setBranchName(''); setBranchDisplayName('');
      const page = await api.branches(selectedCustomer.id); setBranches(page.items); setBranchCursor(page.nextCursor);
      await selectBranch(created.branch);
      setNotice('Branch created inactive, with every module off. Link an active clinic admin before activation.');
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }
  async function inspectLegacy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); setError(''); setAdoptSnapshot(null); setAdoptConfirmed(false);
    try {
      const snapshot = await api.clinic(adoptSlug.trim().toLowerCase());
      if (snapshot.clinic.customerId || snapshot.entitlements.clinicSlug !== snapshot.clinic.slug) {
        throw new ControlApiError(409, 'Clinic is already associated with a customer');
      }
      setAdoptSnapshot(snapshot);
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }
  async function adoptLegacy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCustomer || !adoptSnapshot || !adoptConfirmed || !adoptBranchName.trim()) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const { clinic, entitlements: current } = adoptSnapshot;
      const result = await api.adoptBranch(selectedCustomer.id, {
        slug: clinic.slug, branchName: adoptBranchName.trim(), expectedDisplayName: clinic.displayName,
        expectedActive: clinic.active, expectedClinicVersion: clinic.version,
        expectedEntitlementsVersion: current.version, expectedModules: current.modules,
      });
      setShowAdoptForm(false); setAdoptSlug(''); setAdoptBranchName(''); setAdoptSnapshot(null); setAdoptConfirmed(false);
      const page = await api.branches(selectedCustomer.id); setBranches(page.items); setBranchCursor(page.nextCursor);
      await selectBranch(result.branch);
      setNotice('Existing clinic associated with this customer. Its slug, staff, state and modules were preserved.');
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }
  async function linkStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedBranch) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await api.createStaff(selectedBranch.slug, { username: staffUsername.trim().toLowerCase(), cognitoUsername: staffIdentity.trim(), displayName: staffName.trim(), role: staffRole });
      setShowStaffForm(false); setStaffUsername(''); setStaffIdentity(''); setStaffName('');
      const page = await api.staffPage(selectedBranch.slug); setStaff(page.items); setStaffCursor(page.nextCursor);
      setNotice('Staff membership linked. The individual identity was already provisioned outside this panel.');
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }
  async function saveModules() {
    if (!selectedBranch || !entitlements || !moduleDraft) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const saved = await api.setModules(selectedBranch.slug, entitlements.version, moduleDraft);
      setEntitlements(saved); setModuleDraft(saved.modules); setNotice('Module configuration saved. Clinic services still enforce access server-side.');
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }
  async function changeState(active: boolean) {
    if (!selectedBranch) return;
    if (!active && !window.confirm(`Suspend ${selectedBranch.branchName}? Clinic staff access will stop on the next server check.`)) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const saved = await api.setState(selectedBranch.slug, selectedBranch.version, active, active ? adminUsername.trim().toLowerCase() : null);
      setSelectedBranch(saved); setBranches((old) => old.map((item) => item.slug === saved.slug ? saved : item));
      setNotice(active ? 'Branch activated.' : 'Branch suspended.');
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }
  async function suspendStaff(person: Staff) {
    if (!selectedBranch || !person.active || !window.confirm(`Suspend ${person.displayName} in ${selectedBranch.branchName}?`)) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const saved = await api.updateStaff(selectedBranch.slug, person.username, { expectedVersion: person.version, displayName: person.displayName, role: person.role, active: false });
      setStaff((old) => old.map((item) => item.username === saved.username ? saved : item)); setNotice('Staff membership suspended.');
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }
  function openStaffEdit(person: Staff) {
    setEditingStaff(person); setEditStaffName(person.displayName); setEditStaffRole(person.role);
    setEditStaffActive(person.active); setError('');
  }
  async function saveStaffEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranch || !editingStaff) return;
    if (editingStaff.active && !editStaffActive && !window.confirm(`Suspend ${editingStaff.displayName} in ${selectedBranch.branchName}?`)) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const saved = await api.updateStaff(selectedBranch.slug, editingStaff.username, {
        expectedVersion: editingStaff.version, displayName: editStaffName.trim(), role: editStaffRole, active: editStaffActive,
      });
      setStaff((old) => old.map((item) => item.username === saved.username ? saved : item));
      setEditingStaff(null); setNotice('Staff membership updated.');
    } catch (caught) { fail(caught); }
    finally { setWorking(false); }
  }

  const activeAdmins = staff.filter((person) => person.active && person.role === 'clinic_admin');
  const modulesEnabled = entitlements ? MODULES.filter((name) => entitlements.modules[name]).length : 0;
  return <div className="workspace"><aside className="sidebar"><div className="brand"><span className="brand-mark">✳</span><span>Clinic<span>Pluz</span></span></div><div className="sidebar-caption">CONTROL PANEL</div><nav className="side-nav" aria-label="Main navigation"><button className={section === 'customers' ? 'side-link selected' : 'side-link'} onClick={() => setSection('customers')} type="button"><span aria-hidden="true">▦</span> Customers</button><button className={section === 'operations' ? 'side-link selected' : 'side-link'} onClick={() => setSection('operations')} type="button"><span aria-hidden="true">◈</span> Operations</button></nav><div className="sidebar-bottom"><span className="environment">● Synthetic staging</span><p>Platform-only workspace.<br />No patient or clinical records.</p><button className="sign-out" type="button" onClick={onSignOut}>Sign out ↗</button></div></aside><div className="workspace-main"><header className="topbar"><div className="breadcrumb">Platform <span>/</span> {section === 'operations' ? 'Operations' : selectedBranch ? `${selectedCustomer?.displayName} / ${selectedBranch.branchName}` : selectedCustomer ? selectedCustomer.displayName : 'Customers'}</div><div className="topbar-right"><span className="operator-dot" /> Operator access <button type="button" className="mobile-signout" onClick={onSignOut}>Sign out</button></div></header><main className="content">
    {error && <Banner tone="error">{error} <button type="button" className="text-button" onClick={() => { setError(''); if (selectedBranch) void refreshBranch(); else if (selectedCustomer) void selectCustomer(selectedCustomer); else void loadCustomers(); }}>Refresh</button></Banner>}
    {notice && <Banner tone="success">{notice}</Banner>}
    {section === 'operations' ? <><div className="page-heading"><div><span className="overline">OPERATIONS</span><h1>Operational view</h1><p>Platform metadata, separate from clinical work.</p></div></div><div className="operations-grid"><section className="card"><span className="card-kicker">AVAILABLE NOW</span><h2>Branch setup state</h2><p>Open a branch to review its active state, record version, module configuration and linked staff memberships.</p><button className="button button--soft" type="button" onClick={() => setSection('customers')}>Browse customers →</button></section><section className="card"><span className="card-kicker">NOT YET CONNECTED</span><h2>Health and audit</h2><p>Aggregate service health and audit history do not have a Control Panel read API in this slice. No figures are estimated here.</p></section></div></> : <>
    <div className="page-heading"><div><span className="overline">CUSTOMER NETWORK</span><h1>{selectedBranch ? selectedBranch.branchName : selectedCustomer ? selectedCustomer.displayName : 'Customers & branches'}</h1><p>{selectedBranch ? `${selectedBranch.displayName} · ${selectedBranch.slug}` : selectedCustomer ? 'Manage branches and guide their setup.' : 'Create customers, onboard branches and review their access.'}</p></div><div className="heading-actions">{selectedBranch && <button className="button button--soft" type="button" onClick={() => void refreshBranch()} disabled={detailBusy || working}>Refresh branch</button>}{!selectedCustomer && <button className="button button--primary" type="button" onClick={() => setShowCustomerForm(true)}>+ New customer</button>}{selectedCustomer && !selectedBranch && <><button className="button button--soft" type="button" onClick={() => { setShowAdoptForm(true); setError(''); }}>Adopt existing clinic</button><button className="button button--primary" type="button" onClick={() => setShowBranchForm(true)}>+ Add branch</button></>}</div></div>
    {(selectedCustomer || selectedBranch) && <div className="back-row"><button className="text-button" type="button" onClick={() => { if (working) return; if (selectedBranch) { ++branchDetailSeq.current; setSelectedBranch(null); setEntitlements(null); setDetailBusy(false); } else { ++customerContextSeq.current; ++branchListSeq.current; ++branchDetailSeq.current; setSelectedCustomer(null); setBranches([]); } setError(''); setNotice(''); }}>← {selectedBranch ? 'All branches' : 'All customers'}</button></div>}
    {!selectedCustomer && <><form className="search-row" onSubmit={(event) => { event.preventDefault(); void loadCustomers(customerSearch.trim()); }}><label className="sr-only" htmlFor="customer-search">Search customer name prefix</label><input id="customer-search" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} maxLength={80} placeholder="Search customers by name" /><button className="button button--soft" type="submit" disabled={customerBusy}>Search</button></form>{customerBusy && customers.length === 0 ? <div className="loading-card" role="status">Loading customers…</div> : customerFailed ? <Empty title="Customer list unavailable">Refresh to try again.</Empty> : customers.length === 0 ? <Empty title={customerPrefix ? 'No matching customers' : 'No customers yet'}>{customerPrefix ? 'Try another name prefix.' : 'Create a customer to begin onboarding its branches.'}</Empty> : <div className="customer-list">{customers.map((customer) => <button key={customer.id} className="customer-card" type="button" onClick={() => void selectCustomer(customer)}><span className="avatar">{initials(customer.displayName)}</span><span className="customer-card-main"><strong>{customer.displayName}</strong><small>Added {formatDate(customer.createdAt)}</small></span><span className="card-arrow" aria-hidden="true">→</span></button>)}</div>}{customerCursor && <button className="button button--soft load-more" type="button" disabled={customerBusy} onClick={() => void loadCustomers(customerPrefix, customerCursor)}>{customerBusy ? 'Loading…' : 'Load more customers'}</button>}</>}
    {selectedCustomer && !selectedBranch && <><div className="customer-summary card"><div><span className="card-kicker">CUSTOMER ORGANIZATION</span><h2>{selectedCustomer.displayName}</h2><p>Created {formatDate(selectedCustomer.createdAt)} · Record version {selectedCustomer.version}</p></div><span className="summary-id">ID {selectedCustomer.id}</span></div><div className="section-heading"><div><h2>Branches</h2><p>Each branch has its own unique clinic address and staff access.</p></div></div>{branchBusy && branches.length === 0 ? <div className="loading-card" role="status">Loading branches…</div> : branchFailed ? <Empty title="Branch list unavailable">Refresh to try again.</Empty> : branches.length === 0 ? <Empty title="No branches yet">Add this customer’s first branch. It starts inactive with every module off.</Empty> : <div className="branch-grid">{branches.map((branch) => <button className="branch-card card" type="button" key={branch.slug} onClick={() => void selectBranch(branch)}><div className="branch-card-top"><span className="branch-icon" aria-hidden="true">⌂</span><Status active={branch.active} /></div><strong>{branch.branchName}</strong><span>{branch.displayName}</span><small>{branch.slug} · Version {branch.version}</small><span className="branch-open">Open branch →</span></button>)}</div>}{branchCursor && <button className="button button--soft load-more" type="button" disabled={branchBusy} onClick={() => void loadMoreBranches()}>{branchBusy ? 'Loading…' : 'Load more branches'}</button>}</>}
    {selectedCustomer && detailBusy && <div className="loading-card" role="status">Loading branch setup…</div>}
    {selectedBranch && entitlements && !detailBusy && <><div className="branch-overview card"><div><span className="card-kicker">CLINIC BRANCH</span><div className="branch-title"><h2>{selectedBranch.branchName}</h2><Status active={selectedBranch.active} /></div><p>{selectedBranch.displayName}</p></div><div className="branch-metrics"><div><strong>{modulesEnabled}</strong><span>Modules configured</span></div><div><strong>{staff.length}{staffCursor ? '+' : ''}</strong><span>Staff listed</span></div><div><strong>v{selectedBranch.version}</strong><span>Branch version</span></div></div></div><div className="tabs" role="tablist" aria-label="Branch details">{(['overview', 'team', 'modules', 'operations'] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'tab active' : 'tab'} onClick={() => setTab(item)}>{item === 'team' ? 'Staff access' : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
      {tab === 'overview' && <div className="detail-grid"><section className="card setup-card"><span className="card-kicker">ONBOARDING</span><h2>Branch readiness</h2><ol className="step-list"><li className="done"><span>1</span><div><strong>Branch record created</strong><p>Clinic slug <code>{selectedBranch.slug}</code> was registered and checked by the platform service.</p></div></li><li className={activeAdmins.length ? 'done' : ''}><span>2</span><div><strong>Link an active clinic admin</strong><p>{activeAdmins.length ? `${activeAdmins.length} active admin${activeAdmins.length === 1 ? '' : 's'} in loaded staff records.` : staffCursor ? 'More staff records exist; load them to review clinic admins.' : 'Provision an individual staff identity first, then link its branch membership.'}</p></div></li><li className={modulesEnabled ? 'done' : ''}><span>3</span><div><strong>Configure approved modules</strong><p>{modulesEnabled ? `${modulesEnabled} module${modulesEnabled === 1 ? '' : 's'} currently enabled.` : 'All modules start disabled.'}</p></div></li><li className={selectedBranch.active ? 'done' : ''}><span>4</span><div><strong>Activate the branch</strong><p>Server verifies an active clinic admin and the current branch version.</p></div></li></ol></section><section className="card activation-card"><span className="card-kicker">BRANCH STATUS</span><h2>{selectedBranch.active ? 'Clinic access is active' : 'Ready when you are'}</h2><p>{selectedBranch.active ? 'Staff access depends on each membership and the service-side module checks.' : 'Activation stays blocked until you specify an active clinic admin username.'}</p>{!selectedBranch.active && <div className="field"><label htmlFor="admin-username">Active clinic admin username</label><input id="admin-username" value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} placeholder="e.g. admin.goodwell" autoCapitalize="none" spellCheck={false} /></div>}<button type="button" className={selectedBranch.active ? 'button button--danger' : 'button button--primary'} disabled={working || (!selectedBranch.active && !adminUsername.trim())} onClick={() => void changeState(!selectedBranch.active)}>{working ? 'Updating…' : selectedBranch.active ? 'Suspend branch' : 'Activate branch'}</button><p className="fine-print">Status changes are audited by the server and may revoke staff access.</p></section></div>}
      {tab === 'team' && <><div className="section-heading"><div><h2>Staff memberships</h2><p>Memberships belong to this branch only. Linking does not create staff credentials.</p></div><button className="button button--primary" type="button" onClick={() => setShowStaffForm(true)}>+ Link staff identity</button></div>{staff.length === 0 ? <Empty title="No staff linked">Provision and confirm a staff identity in the clinic identity service before linking it here.</Empty> : <div className="table-wrap card"><table><thead><tr><th scope="col">Staff member</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{staff.map((person) => <tr key={person.username}><td><strong>{person.displayName}</strong></td><td><code>{person.username}</code></td><td>{roleLabels[person.role]}</td><td><Status active={person.active} /></td><td><button type="button" className="text-button" disabled={working} onClick={() => openStaffEdit(person)}>Edit</button>{person.active && <> <span className="action-divider">·</span> <button type="button" className="text-button text-button--danger" disabled={working} onClick={() => void suspendStaff(person)}>Suspend</button></>}</td></tr>)}</tbody></table></div>}{staffCursor && <button type="button" className="button button--soft load-more" disabled={working} onClick={() => void loadMoreStaff()}>{working ? 'Loading…' : 'Load more staff'}</button>}</>}
      {tab === 'modules' && moduleDraft && <><div className="section-heading"><div><h2>Branch modules</h2><p>Version-guarded settings. The backend validates dependencies and clinic services enforce access.</p></div><button className="button button--primary" type="button" disabled={working || MODULES.every((name) => moduleDraft[name] === entitlements.modules[name])} onClick={() => void saveModules()}>{working ? 'Saving…' : 'Save changes'}</button></div><Banner>Only Patient intake, Appointments, Consultations and Billing have active service-side entitlement checks in this pilot. Other keys are shown for visibility and cannot be enabled here yet.</Banner><div className="module-grid">{MODULES.map((name) => <label className={`module-card card ${enforcedModules.has(name) ? '' : 'module-card--planned'}`} key={name}><span><strong>{moduleLabels[name]}</strong><small>{enforcedModules.has(name) ? 'Service check available' : 'Integration pending'}</small></span><input type="checkbox" checked={moduleDraft[name]} disabled={working || !enforcedModules.has(name)} onChange={(event) => setModuleDraft((old) => old ? { ...old, [name]: event.target.checked } : old)} aria-label={`${moduleLabels[name]} enabled`} /></label>)}</div><p className="fine-print">Configuration version {entitlements.version}. A change made elsewhere returns a conflict; refresh before retrying.</p></>}
      {tab === 'operations' && <div className="operations-grid"><section className="card"><span className="card-kicker">RECORD METADATA</span><h2>Current branch record</h2><dl className="metadata"><div><dt>Clinic slug</dt><dd>{selectedBranch.slug}</dd></div><div><dt>Customer ID</dt><dd>{selectedBranch.customerId}</dd></div><div><dt>Branch version</dt><dd>{selectedBranch.version}</dd></div><div><dt>Module version</dt><dd>{entitlements.version}</dd></div><div><dt>Status</dt><dd>{selectedBranch.active ? 'Active' : 'Inactive'}</dd></div></dl></section><section className="card"><span className="card-kicker">NOT YET CONNECTED</span><h2>Audit & service health</h2><p>This API slice does not expose an audit viewer or aggregate health metrics. Changes are audited server-side, but this screen does not invent a timeline or availability figures.</p></section></div>}
    </>}
    </>}
  </main></div>
  {showCustomerForm && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="customer-dialog"><button className="modal-close" type="button" onClick={() => setShowCustomerForm(false)} aria-label="Close">×</button><span className="overline">NEW CUSTOMER</span><h2 id="customer-dialog">Create customer</h2><p>A customer organization can own more than one clinic branch.</p>{error && <Banner tone="error">{error}</Banner>}<form onSubmit={(event) => void createCustomer(event)}><div className="field"><label htmlFor="customer-name">Organization name</label><input id="customer-name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={120} required autoFocus placeholder="e.g. Goodwell Healthcare" /></div><button className="button button--primary" type="submit" disabled={working || !customerName.trim()}>{working ? 'Creating…' : 'Create customer'}</button></form></div></div>}
  {showBranchForm && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="branch-dialog"><button className="modal-close" type="button" onClick={() => setShowBranchForm(false)} aria-label="Close">×</button><span className="overline">NEW BRANCH</span><h2 id="branch-dialog">Add a clinic branch</h2><p>Branch name is unique within {selectedCustomer?.displayName}. The clinic slug is unique across the platform.</p>{error && <Banner tone="error">{error}</Banner>}<form onSubmit={(event) => void createBranch(event)}><div className="field"><label htmlFor="branch-name">Branch name</label><input id="branch-name" value={branchName} onChange={(event) => setBranchName(event.target.value)} maxLength={120} required autoFocus placeholder="e.g. Central" /></div><div className="field"><label htmlFor="branch-display">Clinic display name</label><input id="branch-display" value={branchDisplayName} onChange={(event) => setBranchDisplayName(event.target.value)} maxLength={120} required placeholder="e.g. Goodwell Central Clinic" /></div><div className="field"><label htmlFor="branch-slug">Unique clinic slug</label><input id="branch-slug" value={branchSlug} onChange={(event) => setBranchSlug(event.target.value.toLowerCase())} maxLength={63} pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?" required autoCapitalize="none" spellCheck={false} placeholder="goodwell-central" /><small>Used for the clinic’s sign-in URL. It cannot be changed here after creation.</small></div><button className="button button--primary" type="submit" disabled={working || !branchName.trim() || !branchDisplayName.trim() || !branchSlug.trim()}>{working ? 'Creating…' : 'Create inactive branch'}</button></form></div></div>}
  {showStaffForm && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="staff-dialog"><button className="modal-close" type="button" onClick={() => setShowStaffForm(false)} aria-label="Close">×</button><span className="overline">BRANCH ACCESS</span><h2 id="staff-dialog">Link a staff identity</h2><p>The person must already have an active, confirmed account in the clinic identity service. This action grants a membership for this branch only.</p>{error && <Banner tone="error">{error}</Banner>}<form onSubmit={(event) => void linkStaff(event)}><div className="field"><label htmlFor="staff-user">Branch username</label><input id="staff-user" value={staffUsername} onChange={(event) => setStaffUsername(event.target.value.toLowerCase())} maxLength={128} required autoCapitalize="none" spellCheck={false} /></div><div className="field"><label htmlFor="staff-identity">Existing Cognito username</label><input id="staff-identity" value={staffIdentity} onChange={(event) => setStaffIdentity(event.target.value)} maxLength={128} required autoCapitalize="none" spellCheck={false} /></div><div className="field"><label htmlFor="staff-name">Display name</label><input id="staff-name" value={staffName} onChange={(event) => setStaffName(event.target.value)} maxLength={120} required /></div><div className="field"><label htmlFor="staff-role">Clinic role</label><select id="staff-role" value={staffRole} onChange={(event) => setStaffRole(event.target.value as Role)}>{ROLES.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></div><button className="button button--primary" type="submit" disabled={working || !staffUsername.trim() || !staffIdentity.trim() || !staffName.trim()}>{working ? 'Linking…' : 'Link staff identity'}</button></form></div></div>}
  {showAdoptForm && <div className="modal-backdrop" role="presentation">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="adopt-dialog">
      <button className="modal-close" type="button" onClick={() => setShowAdoptForm(false)} aria-label="Close">×</button>
      <span className="overline">EXISTING SYNTHETIC CLINIC</span>
      <h2 id="adopt-dialog">Adopt an existing clinic</h2>
      <p>Use this only for a reviewed legacy clinic. The server preserves its slug, staff, active state and module settings.</p>
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={(event) => void inspectLegacy(event)}>
        <div className="field"><label htmlFor="adopt-slug">Existing clinic slug</label><input id="adopt-slug" value={adoptSlug} onChange={(event) => { setAdoptSlug(event.target.value.toLowerCase()); setAdoptSnapshot(null); setAdoptConfirmed(false); }} maxLength={63} required autoCapitalize="none" spellCheck={false} placeholder="goodwell" /></div>
        <button type="submit" className="button button--soft" disabled={working || !adoptSlug.trim()}>{working ? 'Checking…' : 'Inspect existing clinic'}</button>
      </form>
      {adoptSnapshot && <form className="adopt-review" onSubmit={(event) => void adoptLegacy(event)}>
        <h3>Review before linking</h3>
        <dl className="metadata"><div><dt>Clinic</dt><dd>{adoptSnapshot.clinic.displayName}</dd></div><div><dt>Slug</dt><dd>{adoptSnapshot.clinic.slug}</dd></div><div><dt>Current state</dt><dd>{adoptSnapshot.clinic.active ? 'Active' : 'Inactive'}</dd></div><div><dt>Clinic version</dt><dd>{adoptSnapshot.clinic.version}</dd></div><div><dt>Module version</dt><dd>{adoptSnapshot.entitlements.version}</dd></div></dl>
        <p className="fine-print">Enabled modules: {MODULES.filter((name) => adoptSnapshot.entitlements.modules[name]).map((name) => moduleLabels[name]).join(', ') || 'none'}.</p>
        <div className="field"><label htmlFor="adopt-name">Branch name within {selectedCustomer?.displayName}</label><input id="adopt-name" value={adoptBranchName} onChange={(event) => setAdoptBranchName(event.target.value)} maxLength={120} required placeholder="e.g. Central" /></div>
        <label className="check-row"><input type="checkbox" checked={adoptConfirmed} onChange={(event) => setAdoptConfirmed(event.target.checked)} /> I reviewed this exact clinic state and module set.</label>
        <button className="button button--primary" type="submit" disabled={working || !adoptConfirmed || !adoptBranchName.trim()}>{working ? 'Associating…' : 'Associate with customer'}</button>
      </form>}
    </div>
  </div>}
  {editingStaff && <div className="modal-backdrop" role="presentation">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-staff-dialog">
      <button className="modal-close" type="button" onClick={() => setEditingStaff(null)} aria-label="Close">×</button>
      <span className="overline">BRANCH ACCESS</span>
      <h2 id="edit-staff-dialog">Edit staff membership</h2>
      <p>Changes apply only to <strong>{editingStaff.username}</strong> in this branch. They do not change the person’s Cognito identity.</p>
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={(event) => void saveStaffEdit(event)}>
        <div className="field"><label htmlFor="edit-staff-name">Display name</label><input id="edit-staff-name" value={editStaffName} onChange={(event) => setEditStaffName(event.target.value)} maxLength={120} required autoFocus /></div>
        <div className="field"><label htmlFor="edit-staff-role">Clinic role</label><select id="edit-staff-role" value={editStaffRole} onChange={(event) => setEditStaffRole(event.target.value as Role)}>{ROLES.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></div>
        <label className="check-row"><input type="checkbox" checked={editStaffActive} onChange={(event) => setEditStaffActive(event.target.checked)} /> Active membership</label>
        <p className="fine-print">Changing or suspending an active clinic admin may require suspending the branch first.</p>
        <button className="button button--primary" type="submit" disabled={working || !editStaffName.trim()}>{working ? 'Saving…' : 'Save membership'}</button>
      </form>
    </div>
  </div>}
  </div>;
}

export default function App() {
  const [stage, setStage] = useState<AuthStage>('checking');
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<AccessSession | null>(null);
  useEffect(() => {
    if (!authConfig) { setStage('configuration'); return; }
    let live = true;
    callbackPromise ??= completeSignIn(authConfig);
    void callbackPromise.then((result) => {
      if (!live) return;
      if (result) { setSession(result); setStage('ready'); }
      else setStage('signed-out');
    }).catch((caught) => { if (live) { setMessage(caught instanceof Error ? caught.message : 'Operator sign-in failed.'); setStage('error'); } });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!session) return;
    const delay = Math.max(0, session.expiresAt - Date.now() - 10_000);
    const timer = window.setTimeout(() => { setSession(null); setStage('signed-out'); }, delay);
    return () => window.clearTimeout(timer);
  }, [session]);
  function signIn() {
    if (!authConfig) return;
    setMessage(''); setStage('checking');
    void startSignIn(authConfig).catch(() => { setMessage('Could not start platform sign-in. Please retry.'); setStage('error'); });
  }
  function signOut() {
    setSession(null); setStage('signed-out');
    if (authConfig) managedSignOut(authConfig);
  }
  if (stage !== 'ready' || !session) return <OperatorGate stage={stage} message={message} onSignIn={signIn} onSignOut={signOut} />;
  return <Workspace session={session} onSignOut={signOut} onAccessLost={(status) => { setSession(null); setStage(status === 403 ? 'denied' : 'signed-out'); }} />;
}
