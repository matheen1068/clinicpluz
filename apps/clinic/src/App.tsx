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
import { resolveClinicSlug } from './tenant';

type View =
  | { kind: 'checking' }
  | { kind: 'invalid-host' }
  | { kind: 'unavailable' }
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

const clinicSlug = resolveClinicSlug(
  window.location.hostname,
  import.meta.env.VITE_CLINIC_BASE_DOMAIN,
  import.meta.env.DEV,
);

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
      const verifiedBootstrap = preview ? await getClinicBootstrap() : bootstrap;
      if (verifiedBootstrap.clinic.slug !== clinicSlug) throw new ApiError(null, 'Clinic mismatch');
      const result = await signIn(username.trim(), password, verifiedBootstrap.csrfToken);
      const confirmed = await getStaffSession();
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

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut(session.csrfToken);
      const remaining = await getStaffSession();
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
      <div className="workspace-topline"><span className="eyebrow">CLINIC WORKSPACE</span><span className="session-badge">● Secure session</span></div>
      <h2>Welcome, {session.user.displayName}</h2>
      <p className="workspace-subtitle">You’re signed in to <strong>{bootstrap.clinic.displayName}</strong> as {ROLE_LABELS[session.user.role]}.</p>
      <div className="workspace-placeholder"><span className="placeholder-icon" aria-hidden="true">✳</span><h3>Your workspace is taking shape</h3><p>Clinic tools will appear here when they are ready for your team.</p></div>
      <button className="secondary-button" type="button" onClick={handleSignOut} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'} <ArrowIcon /></button>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>(clinicSlug ? { kind: 'checking' } : { kind: 'invalid-host' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!clinicSlug) return;
    let active = true;
    async function initialize() {
      setView({ kind: 'checking' });
      try {
        const bootstrap = await getClinicBootstrap();
        if (bootstrap.clinic.slug !== clinicSlug) throw new ApiError(null, 'Clinic mismatch');
        const session = await getStaffSession();
        if (session && session.clinicSlug !== clinicSlug) throw new ApiError(null, 'Clinic mismatch');
        if (active) setView(session ? { kind: 'signed-in', bootstrap, session } : { kind: 'sign-in', bootstrap });
      } catch {
        if (active) setView({ kind: 'unavailable' });
      }
    }
    void initialize();
    return () => { active = false; };
  }, [reloadKey]);

  return (
    <main className="app-layout">
      <BrandStory />
      <section className="login-panel" aria-label="Clinic staff access">
        <div className="panel-top"><span className="panel-top-label">STAFF PORTAL</span><span className="panel-top-rule" /></div>
        <div className="panel-center">
          {view.kind === 'sign-in' && <SignInForm bootstrap={view.bootstrap} onSuccess={(bootstrap, session) => setView({ kind: 'signed-in', bootstrap, session })} />}
          {view.kind === 'signed-in' && <SignedInShell bootstrap={view.bootstrap} session={view.session} onSignedOut={() => setReloadKey((count) => count + 1)} onUnverified={() => setView({ kind: 'unavailable' })} />}
          {view.kind === 'unavailable' && import.meta.env.DEV && clinicSlug && <SignInForm preview bootstrap={{ clinic: { slug: clinicSlug, displayName: `${clinicSlug[0].toUpperCase()}${clinicSlug.slice(1)} Clinic` }, csrfToken: '' }} onSuccess={(bootstrap, session) => setView({ kind: 'signed-in', bootstrap, session })} />}
          {(view.kind === 'checking' || view.kind === 'invalid-host' || (view.kind === 'unavailable' && !import.meta.env.DEV)) && <StatusCard kind={view.kind} onRetry={() => setReloadKey((count) => count + 1)} />}
        </div>
        <div className="panel-footer"><span>ClinicPluz</span><span>For authorized clinic staff only</span></div>
      </section>
    </main>
  );
}
