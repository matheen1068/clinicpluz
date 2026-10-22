import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ControlApi, ControlApiError, safeError, type Branch, type BranchDiagnostics, type Page,
} from './controlApi';

const moduleNames: Record<string, string> = {
  patient_intake: 'Patient intake', appointments: 'Appointments', vitals: 'Vitals',
  consultations: 'Consultations', prescriptions: 'Prescriptions', lab_reports: 'Lab reports',
  billing: 'Billing', email_notifications: 'Email notifications',
};
const changeNames: Record<string, string> = {
  'branch.created': 'Branch created', 'branch.legacy_adopted': 'Existing branch associated',
  'staff.created': 'Staff membership linked', 'staff.updated': 'Staff membership updated',
  'modules.replaced': 'Module settings updated', 'clinic.state_changed': 'Branch state changed',
};

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function accessDenied(error: unknown): error is ControlApiError {
  return error instanceof ControlApiError && (error.status === 401 || error.status === 403);
}

export function BranchDiagnostics({ api, branch, onAccessLost }: {
  api: ControlApi; branch: Branch; onAccessLost: (status: number) => void;
}) {
  const requestSeq = useRef(0);
  const [result, setResult] = useState<BranchDiagnostics | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    const seq = ++requestSeq.current;
    setBusy(true); setError(''); setResult(null);
    try {
      const data = await api.diagnostics(branch.slug);
      if (seq !== requestSeq.current) return;
      if (data.branch.customerId !== branch.customerId) throw new ControlApiError(null, 'Branch context mismatch');
      setResult(data);
    } catch (caught) {
      if (seq !== requestSeq.current) return;
      if (accessDenied(caught)) onAccessLost(caught.status!);
      else setError(caught instanceof ControlApiError && caught.status === 404
        ? 'This branch is no longer available in the control directory. Refresh the branch list.'
        : safeError(caught));
    } finally { if (seq === requestSeq.current) setBusy(false); }
  }
  useEffect(() => {
    void refresh();
    return () => { ++requestSeq.current; };
  }, [api, branch.slug, branch.customerId]);

  return <div className="diagnostics" aria-live="polite">
    <div className="section-heading diagnostics-heading"><div><span className="overline">BRANCH DIAGNOSTICS</span><h2>{branch.branchName}</h2><p>Control records and recent platform changes. This is not a Clinic App health check.</p></div><button className="button button--soft" type="button" onClick={() => void refresh()} disabled={busy}>{busy ? 'Checking…' : 'Refresh checks'}</button></div>
    {busy && <div className="loading-card" role="status">Checking branch configuration and recent changes…</div>}
    {!busy && error && <div className="diagnostics-error card" role="alert"><strong>Checks unavailable</strong><p>{error} No health status can be inferred from this failure.</p><button className="button button--soft" type="button" onClick={() => void refresh()}>Try again</button></div>}
    {!busy && result && <>
      <p className="diagnostics-checked">Checked {dateTime(result.checkedAt)} · Branch <code>{result.branch.slug}</code></p>
      <div className="diagnostics-grid">
        <section className="card diagnostics-card" aria-labelledby="diag-configuration"><span className="card-kicker">DIRECT CONTROL RECORDS</span><h3 id="diag-configuration">Configuration checks</h3><dl className="diagnostics-checks">
          <div><dt>Branch access setting</dt><dd><strong>{result.branch.active ? 'Active' : 'Suspended'}</strong><small>Control record v{result.branch.version}; this does not test staff sign-in.</small></dd></div>
          <div><dt>Clinic admin membership</dt><dd><strong>{result.configuration.staff.activeAdmin === 'present' ? 'Found in sample' : result.configuration.staff.activeAdmin === 'missing' ? 'Not found' : 'Unknown'}</strong><small>{result.configuration.staff.sampledCount} staff membership{result.configuration.staff.sampledCount === 1 ? '' : 's'} checked{result.configuration.staff.hasMore ? '; more records exist' : ''}. {result.configuration.staff.activeAdmin === 'unknown' ? 'This sample cannot prove absence.' : 'Identity-provider sign-in was not tested.'}</small></dd></div>
          <div><dt>Module configuration</dt><dd><strong>{result.configuration.entitlements.state === 'present' ? `Present · v${result.configuration.entitlements.version}` : 'Missing'}</strong><small>{result.configuration.entitlements.state === 'missing' ? 'The branch needs its module record restored before access can be verified.' : `${result.configuration.entitlements.enabledModules.length} enabled in the control record; consuming services still enforce access.`}</small></dd></div>
        </dl>{result.configuration.entitlements.state === 'present' && <div className="diagnostics-modules"><strong>Enabled modules</strong>{result.configuration.entitlements.enabledModules.length ? <ul>{result.configuration.entitlements.enabledModules.map((name) => <li key={name}>{moduleNames[name] ?? name}</li>)}</ul> : <p>None enabled.</p>}</div>}</section>
        <section className="card diagnostics-card" aria-labelledby="diag-telemetry"><span className="card-kicker">RUNTIME COVERAGE</span><h3 id="diag-telemetry">Service signals</h3><p>These services have no verified telemetry in this slice. A configuration read cannot confirm availability or a completed clinic workflow.</p><ul className="diagnostics-signals"><li><span>Clinic sign-in</span><strong>Not instrumented</strong></li><li><span>Clinic workflows</span><strong>Not instrumented</strong></li><li><span>Email delivery</span><strong>Not instrumented</strong></li></ul><p className="fine-print">Request errors, latency, booking failures and delivery outcomes will need a separate sanitized telemetry source.</p></section>
      </div>
      <section className="card diagnostics-card diagnostics-activity" aria-labelledby="diag-activity"><div className="diagnostics-activity-head"><div><span className="card-kicker">PLATFORM CHANGES ONLY</span><h3 id="diag-activity">Recent control activity</h3><p>{dateTime(result.recentChanges.from)} to {dateTime(result.recentChanges.to)} · Newest {result.recentChanges.items.length} shown{result.recentChanges.hasMore ? '; more exist' : ''}.</p></div></div>{result.recentChanges.items.length ? <ol className="diagnostics-events">{result.recentChanges.items.map((change) => <li key={change.id}><time dateTime={change.at}>{dateTime(change.at)}</time><span>{changeNames[change.action] ?? 'Platform configuration changed'}</span></li>)}</ol> : <p>No platform control changes were found in this seven-day window. This does not cover clinic workflows.</p>}</section>
    </>}
  </div>;
}

export function DiagnosticsWorkspace({ api, initialBranch, onAccessLost }: {
  api: ControlApi; initialBranch: Branch | null; onAccessLost: (status: number) => void;
}) {
  const requestSeq = useRef(0);
  const [selected, setSelected] = useState<Branch | null>(initialBranch);
  const [prefix, setPrefix] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<Page<Branch>>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(!initialBranch);
  const [error, setError] = useState('');

  async function load(nextPrefix: string, cursor?: string) {
    const seq = ++requestSeq.current;
    setBusy(true); setError('');
    if (!cursor) setPage({ items: [], nextCursor: null });
    try {
      const response = await api.branchDirectory(nextPrefix, cursor);
      if (seq !== requestSeq.current) return;
      setPage((old) => ({ items: cursor ? [...old.items, ...response.items] : response.items, nextCursor: response.nextCursor }));
      setPrefix(nextPrefix);
    } catch (caught) {
      if (seq !== requestSeq.current) return;
      if (accessDenied(caught)) onAccessLost(caught.status!);
      else setError(safeError(caught));
    } finally { if (seq === requestSeq.current) setBusy(false); }
  }
  useEffect(() => {
    if (!initialBranch) void load('');
    return () => { ++requestSeq.current; };
  }, [api]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim().toLowerCase();
    if (!/^[a-z0-9-]{0,63}$/.test(value)) { setError('Use a clinic slug prefix with lowercase letters, numbers or hyphens.'); return; }
    void load(value);
  }
  return <>
    <div className="page-heading"><div><span className="overline">OPERATIONS</span><h1>Diagnostics</h1><p>Find a branch and inspect verified platform signals. No patient or clinical records appear here.</p></div></div>
    {selected ? <><button className="text-button diagnostics-back" type="button" onClick={() => { setSelected(null); void load(prefix); }}>← All branches</button><BranchDiagnostics key={selected.slug} api={api} branch={selected} onAccessLost={onAccessLost} /></> : <>
      <form className="search-row" onSubmit={submit}><label className="sr-only" htmlFor="diagnostics-search">Search branch slug prefix</label><input id="diagnostics-search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={63} placeholder="Search by clinic slug" autoCapitalize="none" spellCheck={false} /><button className="button button--soft" type="submit" disabled={busy}>Search</button></form>
      {error && <div className="banner banner--error" role="alert">{error} <button className="text-button" type="button" onClick={() => void load(prefix)}>Retry</button></div>}
      {busy && page.items.length === 0 ? <div className="loading-card" role="status">Loading branch directory…</div> : !error && page.items.length === 0 ? <div className="empty"><h3>{prefix ? 'No matching branches' : 'No branches yet'}</h3><p>{prefix ? 'Try another clinic slug prefix.' : 'Create a customer and branch to begin setup checks.'}</p></div> : <div className="branch-grid">{page.items.map((branch) => <button className="branch-card card" type="button" key={branch.slug} onClick={() => setSelected(branch)}><div className="branch-card-top"><span className="branch-icon" aria-hidden="true">⌂</span><span className={`status ${branch.active ? 'status--active' : 'status--inactive'}`}>{branch.active ? 'Active' : 'Inactive'}</span></div><strong>{branch.branchName}</strong><span>{branch.displayName}</span><small>{branch.slug}</small><span className="branch-open">View diagnostics →</span></button>)}</div>}
      {page.nextCursor && <button className="button button--soft load-more" type="button" disabled={busy} onClick={() => void load(prefix, page.nextCursor!)}>{busy ? 'Loading…' : 'Load more branches'}</button>}
    </>}
  </>;
}
