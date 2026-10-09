import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  getClinicBootstrap,
  getStaffSession,
  signIn,
  signOut,
  type ClinicBootstrap,
  type ClinicRole,
  type StaffSession,
} from './api';
import { resolveClinicContext } from './tenant';
import Workflow from './Workflow';
import Consultation from './Consultation';

type View =
  | { kind: 'checking' }
  | { kind: 'invalid-host' }
  | { kind: 'unavailable'; previewAllowed: boolean }
  | { kind: 'sign-in'; bootstrap: ClinicBootstrap }
  | { kind: 'signed-in'; bootstrap: ClinicBootstrap; session: StaffSession };

const ROLE_LABELS: Record<ClinicRole, string> = {
  clinic_admin: 'Clinic admin',
  doctor: 'Doctor',
  receptionist: 'Receptionist',
  nurse: 'Nurse',
  lab_tech: 'Lab technician',
  billing: 'Billing staff',
};

const clinicContext = resolveClinicContext(
  window.location.hostname,
  window.location.pathname,
  import.meta.env.VITE_CLINIC_BASE_DOMAIN,
  import.meta.env.VITE_DEMO_HOSTNAME,
  import.meta.env.DEV,
);
const clinicSlug = clinicContext?.slug ?? null;
const showDesignPreview = import.meta.env.DEV || clinicContext?.mode === 'demo-path';

function ClinicMark({ light = false }: { light?: boolean }) {
  return (
    <span className={`clinic-mark${light ? ' clinic-mark--light' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none" focusable="false">
        <path d="M5 20h9l3-8 6 16 3-8h9" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M8.5 5.5A11.2 11.2 0 0 1 12 5c5 0 9 5 9 7a10.5 10.5 0 0 1-3 3.7M6 7.2C4.1 8.5 3 10.4 3 12c0 2 4 7 9 7 1.5 0 3-.4 4.2-1.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function BrandStory() {
  return (
    <aside className="story-panel" aria-label="ClinicPluz">
      <div className="story-orb story-orb--one" />
      <div className="story-orb story-orb--two" />
      <div className="story-content">
        <div className="brand brand--light"><ClinicMark light /><span>Clinic<span className="brand-accent">Pluz</span></span></div>
        <div className="story-main">
          <span className="eyebrow eyebrow--light"><span className="eyebrow-dot" /> Built for the people behind care</span>
          <h1>A calmer clinic day starts here<span className="story-period">.</span></h1>
          <p>One connected workspace for your team—from the first appointment to the final handoff.</p>
          <div className="journey-card" aria-hidden="true">
            <div className="journey-heading"><span className="journey-spark">✳</span> The daily flow</div>
            <div className="journey-line">
              <span className="journey-step"><i>01</i> Welcome</span>
              <span className="journey-connector" />
              <span className="journey-step"><i>02</i> Coordinate</span>
              <span className="journey-connector" />
              <span className="journey-step"><i>03</i> Care</span>
            </div>
          </div>
        </div>
        <p className="story-footer">Made for clinics and small hospitals.</p>
      </div>
    </aside>
  );
}

function SignInForm({ bootstrap, preview = false, onSuccess }: { bootstrap: ClinicBootstrap; preview?: boolean; onSuccess: (bootstrap: ClinicBootstrap, session: StaffSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !clinicSlug) return;
    setError('');
    setBusy(true);
    try {
      const verifiedBootstrap = preview ? await getClinicBootstrap(clinicSlug) : bootstrap;
      if (verifiedBootstrap.clinic.slug !== clinicSlug) throw new ApiError(null, 'Clinic mismatch');
      const result = await signIn(clinicSlug, username.trim(), password, verifiedBootstrap.csrfToken);
      const confirmed = await getStaffSession(clinicSlug);
      if (!confirmed || result.clinicSlug !== clinicSlug || confirmed.clinicSlug !== clinicSlug ||
          confirmed.user.id !== result.user.id) {
        throw new ApiError(null, 'The clinic session could not be verified');
      }
      setPassword('');
      onSuccess(verifiedBootstrap, confirmed);
    } catch (caught) {
      setPassword('');
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Username or password is incorrect. Please try again.');
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError('Your account does not have access to this clinic. Contact your clinic administrator.');
      } else if (caught instanceof ApiError && caught.status === 429) {
        setError('Too many attempts. Please wait and try again.');
      } else {
        setError('Sign-in is unavailable right now. Please try again shortly.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {preview && <p className="preview-banner" role="status">Design preview · Clinic service unavailable, so this identity is unverified. Real sign-in requires the server.</p>}
      <div className="clinic-identity">
        <span className="clinic-avatar" aria-hidden="true">{bootstrap.clinic.displayName.trim().charAt(0).toUpperCase()}</span>
        <div><span className="identity-label">YOUR CLINIC WORKSPACE</span><strong>{bootstrap.clinic.displayName}</strong></div>
        {!preview && <span className="identity-check" title="Clinic verified by service" aria-label="Clinic verified by service">✓</span>}
      </div>
      <div className="form-heading">
        <span className="eyebrow">STAFF SIGN-IN</span>
        <h2>Welcome back</h2>
        <p>Sign in with your staff credentials to continue.</p>
      </div>
      <form onSubmit={handleSubmit} className="login-form" aria-busy={busy}>
        <div className="field"><label htmlFor="username">Username</label><input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter your username" required disabled={busy} /></div>
        <div className="field"><label htmlFor="password">Password</label><div className="password-wrap"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required disabled={busy} /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={busy}><EyeIcon hidden={showPassword} /></button></div></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to your clinic'}{!busy && <ArrowIcon />}</button>
      </form>
      <p className="help-note">Need access or forgot your password? <strong>Contact your clinic administrator.</strong></p>
    </>
  );
}

function StatusCard({ kind, onRetry }: { kind: 'checking' | 'invalid-host' | 'unavailable'; onRetry: () => void }) {
  const content = {
    checking: { title: 'Checking your clinic', body: 'We’re securely connecting to your clinic workspace.' },
    'invalid-host': { title: 'Clinic link needed', body: 'Open the sign-in link provided by your clinic administrator.' },
    unavailable: { title: 'Clinic sign-in is unavailable', body: 'We couldn’t verify this clinic right now. Please check the link or try again shortly.' },
  }[kind];
  return (
    <div className="status-card" role={kind === 'unavailable' ? 'alert' : 'status'}>
      <span className={`status-symbol${kind === 'checking' ? ' status-symbol--loading' : ''}`} aria-hidden="true">{kind === 'checking' ? '↻' : '!'}</span>
      <h2>{content.title}</h2>
      <p>{content.body}</p>
      {kind === 'unavailable' && <button className="secondary-button" onClick={onRetry} type="button">Try again <ArrowIcon /></button>}
    </div>
  );
}

function SignedInShell({ bootstrap, session, onSignedOut, onUnverified }: { bootstrap: ClinicBootstrap; session: StaffSession; onSignedOut: () => void; onUnverified: () => void }) {
  const [busy, setBusy] = useState(false);
  const [activeModule, setActiveModule] = useState<'reception' | 'consultation'>(session.user.role === 'doctor' ? 'consultation' : 'reception');
  const [consultationDirty, setConsultationDirty] = useState(false);
  const [consultationPending, setConsultationPending] = useState(false);
  const canReception = session.user.role === 'clinic_admin' || session.user.role === 'receptionist' || session.user.role === 'nurse';
  const canConsultation = session.user.role === 'doctor' || session.user.role === 'nurse';

  useEffect(() => { setActiveModule(session.user.role === 'doctor' ? 'consultation' : 'reception'); }, [session.user.role]);

  function selectModule(next: 'reception' | 'consultation') {
    if (next === activeModule || consultationPending ||
        (activeModule === 'consultation' && consultationDirty && !window.confirm('Leave consultation with unsaved or unverified changes?'))) return;
    setActiveModule(next);
  }

  async function handleSignOut() {
    if (consultationPending) return;
    if (consultationDirty && !window.confirm('Leave consultation with unsaved or unverified changes and sign out?')) return;
    setBusy(true);
    try {
      if (!clinicSlug) throw new ApiError(null, 'Clinic link missing');
      await signOut(clinicSlug, session.csrfToken);
      const remaining = await getStaffSession(clinicSlug);
      if (remaining) throw new ApiError(null, 'Session was not closed');
      onSignedOut();
    } catch {
      onUnverified();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-header"><div><span className="eyebrow">CLINIC WORKSPACE</span><h2>{bootstrap.clinic.displayName}</h2><p className="workspace-subtitle">Signed in as <strong>{session.user.displayName}</strong> · {ROLE_LABELS[session.user.role]}</p></div><div className="workspace-header-actions"><span className="session-badge">● Secure session</span><button className="secondary-button" type="button" onClick={handleSignOut} disabled={busy || consultationPending}>{busy ? 'Signing out…' : consultationPending ? 'Saving…' : 'Sign out'} <ArrowIcon /></button></div></header>
      {(canReception || canConsultation) && <nav className="workspace-nav" aria-label="Clinic modules">{canReception && <button type="button" aria-current={activeModule === 'reception' ? 'page' : undefined} disabled={consultationPending} onClick={() => selectModule('reception')}>Reception</button>}{canConsultation && <button type="button" aria-current={activeModule === 'consultation' ? 'page' : undefined} disabled={consultationPending} onClick={() => selectModule('consultation')}>Consultations</button>}</nav>}
      {activeModule === 'reception' && canReception && <Workflow clinicSlug={session.clinicSlug} csrfToken={session.csrfToken} role={session.user.role} onSessionLost={onUnverified} />}
      {activeModule === 'consultation' && canConsultation && <Consultation clinicSlug={session.clinicSlug} csrfToken={session.csrfToken} role={session.user.role} onSessionLost={onUnverified} onDirtyChange={setConsultationDirty} onPendingChange={setConsultationPending} />}
      {!canReception && !canConsultation && <section className="workflow-access" role="status"><h3>No clinic modules assigned</h3><p>Contact your clinic administrator for access to an enabled module.</p></section>}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>(clinicSlug ? { kind: 'checking' } : { kind: 'invalid-host' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const slug = clinicSlug;
    if (!slug) return;
    let active = true;
    async function initialize(selectedSlug: string) {
      setView({ kind: 'checking' });
      let bootstrapVerified = false;
      try {
        const bootstrap = await getClinicBootstrap(selectedSlug);
        if (bootstrap.clinic.slug !== selectedSlug) throw new ApiError(null, 'Clinic mismatch');
        bootstrapVerified = true;
        const session = await getStaffSession(selectedSlug);
        if (session && session.clinicSlug !== selectedSlug) throw new ApiError(null, 'Clinic mismatch');
        if (active) setView(session ? { kind: 'signed-in', bootstrap, session } : { kind: 'sign-in', bootstrap });
      } catch (error) {
        if (active) setView({ kind: 'unavailable', previewAllowed: !bootstrapVerified && error instanceof ApiError && error.status === null });
      }
    }
    void initialize(slug);
    return () => { active = false; };
  }, [reloadKey]);

  return (
    <main className={`app-layout${view.kind === 'signed-in' ? ' app-layout--workspace' : ''}`}>
      {view.kind !== 'signed-in' && <BrandStory />}
      <section className="login-panel" aria-label="Clinic staff access">
        <div className="panel-top"><span className="panel-top-label">STAFF PORTAL</span><span className="panel-top-rule" /></div>
        <div className="panel-center">
          {clinicContext?.mode === 'demo-path' && <p className="demo-banner" role="status">ClinicPluz demo environment · Use synthetic data only</p>}
          {view.kind === 'sign-in' && <SignInForm bootstrap={view.bootstrap} onSuccess={(bootstrap, session) => setView({ kind: 'signed-in', bootstrap, session })} />}
          {view.kind === 'signed-in' && <SignedInShell bootstrap={view.bootstrap} session={view.session} onSignedOut={() => setReloadKey((count) => count + 1)} onUnverified={() => setView({ kind: 'unavailable', previewAllowed: false })} />}
          {view.kind === 'unavailable' && view.previewAllowed && showDesignPreview && clinicSlug && <SignInForm preview bootstrap={{ clinic: { slug: clinicSlug, displayName: `${clinicSlug[0].toUpperCase()}${clinicSlug.slice(1)} Clinic` }, csrfToken: '' }} onSuccess={(bootstrap, session) => setView({ kind: 'signed-in', bootstrap, session })} />}
          {(view.kind === 'checking' || view.kind === 'invalid-host' || (view.kind === 'unavailable' && (!view.previewAllowed || !showDesignPreview))) && <StatusCard kind={view.kind} onRetry={() => setReloadKey((count) => count + 1)} />}
        </div>
        <div className="panel-footer"><span>ClinicPluz</span><span>For authorized clinic staff only</span></div>
      </section>
    </main>
  );
}
