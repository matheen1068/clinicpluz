import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ClinicProfileApiError, draftFromProfile, getClinicProfile, removeClinicLogo,
  saveClinicProfile, uploadClinicLogo, validateProfileDraft,
  type ClinicProfile as ClinicProfileRecord, type ProfileAccess, type ProfileDraft,
} from './clinicProfileApi';

const blank: ProfileDraft = { displayName: '', address: '', phone: '', email: '' };
function sameDraft(a: ProfileDraft, b: ProfileDraft): boolean {
  return a.displayName === b.displayName && a.address === b.address && a.phone === b.phone && a.email === b.email;
}
function message(error: unknown): string {
  if (error instanceof ClinicProfileApiError) {
    if (error.status === 409) return 'Clinic details changed elsewhere. Refresh to review the latest version before saving.';
    if (error.status === 400 || error.status === 422) return 'The details or logo could not be accepted. Check the fields and try again.';
    if (error.status === 403) return 'Your current clinic access does not allow this change.';
    if (error.status === 413) return 'This logo is too large. Choose a PNG or JPEG up to 3 MB.';
    if (error.message.startsWith('Choose a PNG')) return error.message;
  }
  return 'Clinic details could not be verified. Please try again.';
}

export default function ClinicProfile({ clinicSlug, csrfToken, onSessionLost, onDirtyChange, onPendingChange, onIdentityChange }: {
  clinicSlug: string; csrfToken: string; onSessionLost: () => void;
  onDirtyChange: (dirty: boolean) => void; onPendingChange: (pending: boolean) => void;
  onIdentityChange: (profile: ClinicProfileRecord) => void;
}) {
  const [access, setAccess] = useState<ProfileAccess | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>(blank);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const sequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const textDirty = access !== null && !sameDraft(draft, draftFromProfile(access.profile));
  const dirty = textDirty || logoFile !== null;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useEffect(() => () => { onDirtyChange(false); onPendingChange(false); }, [onDirtyChange, onPendingChange]);

  async function load(signal?: AbortSignal) {
    const id = ++sequence.current;
    setLoading(true); setError(''); setSuccess('');
    try {
      const loaded = await getClinicProfile(clinicSlug, signal);
      if (id !== sequence.current || signal?.aborted) return;
      setAccess(loaded); setDraft(draftFromProfile(loaded.profile)); setLogoFile(null); setLogoBroken(false);
      onIdentityChange(loaded.profile);
    } catch (caught) {
      if (id !== sequence.current || signal?.aborted) return;
      if (caught instanceof ClinicProfileApiError && caught.status === 401) onSessionLost();
      else setError(caught instanceof ClinicProfileApiError && caught.status === 403
        ? 'This clinic profile is unavailable to your account.' : message(caught));
      setAccess(null);
    } finally { if (id === sequence.current && !signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { ++sequence.current; controller.abort(); };
  }, [clinicSlug]);

  function applySaved(saved: ProfileAccess, notice: string, clearSelectedLogo = true) {
    setAccess(saved); setDraft(draftFromProfile(saved.profile)); setLogoBroken(false);
    if (clearSelectedLogo) { setLogoFile(null); if (fileInput.current) fileInput.current.value = ''; }
    onIdentityChange(saved.profile);
    setSuccess(notice);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!access?.canEdit || pending) return;
    const invalid = validateProfileDraft(draft);
    if (invalid) { setError(invalid); return; }
    setPending(true); setError(''); setSuccess('');
    try { applySaved(await saveClinicProfile(clinicSlug, draft, access.profile.revision, csrfToken), 'Clinic details saved. New prescription prints use these details.', false); }
    catch (caught) {
      if (caught instanceof ClinicProfileApiError && caught.status === 401) onSessionLost();
      else setError(message(caught));
    } finally { setPending(false); }
  }
  async function changeLogo(remove: boolean) {
    if (!access?.canEdit || pending || (!remove && !logoFile)) return;
    setPending(true); setError(''); setSuccess('');
    try {
      const saved = remove
        ? await removeClinicLogo(clinicSlug, access.profile.revision, csrfToken)
        : await uploadClinicLogo(clinicSlug, logoFile!, access.profile.revision, csrfToken);
      const unsaved = draft;
      applySaved(saved, remove ? 'Clinic logo removed. New prescription prints omit it.' : 'Clinic logo saved for new prescription prints.');
      // A logo update must not discard edits in the text form.
      if (textDirty) setDraft(unsaved);
    } catch (caught) {
      if (caught instanceof ClinicProfileApiError && caught.status === 401) onSessionLost();
      else setError(message(caught));
    } finally { setPending(false); }
  }
  function refresh() {
    if (pending || (dirty && !window.confirm('Discard unsaved clinic details and load the latest server version?'))) return;
    void load();
  }
  const profile = access?.profile;
  return <section className="clinic-profile workflow" aria-labelledby="clinic-profile-title">
    <div className="workflow-intro"><div><span className="eyebrow">CLINIC IDENTITY</span><h3 id="clinic-profile-title">Clinic details</h3><p>Keep the contact and branding shown on new prescription prints up to date.</p></div><span className="workflow-pilot">Synthetic pilot</span></div>
    <p className="workflow-notice">These are clinic contact details, separate from patient records. The server checks who may edit them. Existing printed copies are not changed.</p>
    {loading && <div className="workflow-card clinic-profile-state" role="status">Loading the verified clinic profile…</div>}
    {!loading && !access && <div className="workflow-card clinic-profile-state" role="alert"><h4>Clinic details unavailable</h4><p>{error || 'The profile could not be verified.'}</p><button className="workflow-link" type="button" onClick={refresh}>Try again</button></div>}
    {!loading && access && <>
      <div className="clinic-profile-toolbar"><span>Server record · Revision {profile!.revision}</span><button className="workflow-link" type="button" onClick={refresh} disabled={pending}>Refresh latest</button></div>
      {error && <p className="workflow-error" role="alert">{error}</p>}
      {success && <p className="workflow-success" role="status">{success}</p>}
      <div className="clinic-profile-grid">
        <div className="clinic-profile-edit">
          <section className="workflow-card" aria-labelledby="profile-contact-title"><div className="workflow-card-head"><div><span className="workflow-step">01</span><h4 id="profile-contact-title">Identity & contact</h4></div><p>Clear an optional field and save to remove it from the profile.</p></div>
            <form className="workflow-form clinic-profile-form" onSubmit={(event) => void save(event)}>
              <label htmlFor="profile-name">Clinic display name<input id="profile-name" value={draft.displayName} onChange={(event) => setDraft((old) => ({ ...old, displayName: event.target.value }))} minLength={2} maxLength={120} required disabled={!access.canEdit || pending} /></label>
              <label htmlFor="profile-address">Address <span className="workflow-optional">(optional)</span><textarea id="profile-address" value={draft.address} onChange={(event) => setDraft((old) => ({ ...old, address: event.target.value }))} maxLength={300} rows={3} disabled={!access.canEdit || pending} /></label>
              <div className="workflow-fields"><label htmlFor="profile-phone">Contact phone <span className="workflow-optional">(optional)</span><input id="profile-phone" type="tel" value={draft.phone} onChange={(event) => setDraft((old) => ({ ...old, phone: event.target.value }))} maxLength={30} autoComplete="tel" disabled={!access.canEdit || pending} /></label><label htmlFor="profile-email">Contact email <span className="workflow-optional">(optional)</span><input id="profile-email" type="email" value={draft.email} onChange={(event) => setDraft((old) => ({ ...old, email: event.target.value }))} maxLength={254} autoComplete="email" disabled={!access.canEdit || pending} /></label></div>
              {access.canEdit ? <div className="clinic-profile-actions"><span>{textDirty ? 'You have unsaved text changes.' : 'Text details match the server record.'}</span><button className="workflow-action" type="submit" disabled={pending || !textDirty}>{pending ? 'Saving…' : 'Save details'}</button></div> : <p className="workflow-hint">Your account can view these details but cannot edit them.</p>}
            </form>
          </section>
          <section className="workflow-card" aria-labelledby="profile-logo-title"><div className="workflow-card-head"><div><span className="workflow-step">02</span><h4 id="profile-logo-title">Clinic logo</h4></div><p>PNG or JPEG · up to 3 MB · maximum 2048 × 2048 pixels.</p></div>
            <div className="clinic-profile-logo-row"><div className="clinic-profile-logo-frame">{profile?.logo && !logoBroken ? <img src={profile.logo.url} key={profile.revision} alt={`${profile.displayName} logo`} onError={() => setLogoBroken(true)} /> : <span aria-hidden="true">{profile?.displayName.slice(0, 1).toUpperCase() || 'C'}</span>}</div><div><strong>{profile?.logo && !logoBroken ? 'Current saved logo' : profile?.logo ? 'Logo could not be displayed' : 'No logo saved'}</strong><p>Prescription printing uses the currently saved logo. Changes here do not alter the medicine order.</p></div></div>
            {access.canEdit && <div className="clinic-profile-logo-actions"><label htmlFor="profile-logo-file">Choose a logo</label><input ref={fileInput} id="profile-logo-file" type="file" accept="image/png,image/jpeg" onChange={(event) => { setLogoFile(event.target.files?.[0] ?? null); setError(''); }} disabled={pending} /><div><button className="workflow-link" type="button" onClick={() => void changeLogo(false)} disabled={pending || !logoFile}>{pending ? 'Saving…' : 'Upload selected logo'}</button>{profile?.logo && <button className="workflow-link clinic-profile-remove" type="button" onClick={() => void changeLogo(true)} disabled={pending}>Remove logo</button>}</div></div>}
          </section>
        </div>
        <aside className="workflow-card clinic-profile-preview" aria-label="Clinic identity preview"><span className="eyebrow">SAVED PROFILE PREVIEW</span><div className="clinic-profile-preview-head">{profile?.logo && !logoBroken ? <img src={profile.logo.url} key={`preview-${profile.revision}`} alt="" onError={() => setLogoBroken(true)} /> : <span aria-hidden="true">{profile?.displayName.slice(0, 1).toUpperCase() || 'C'}</span>}<div><strong>{profile?.displayName}</strong><small>Clinic identity on a new prescription print</small></div></div><dl><div><dt>Address</dt><dd>{profile?.address || 'Not added'}</dd></div><div><dt>Phone</dt><dd>{profile?.phone || 'Not added'}</dd></div><div><dt>Email</dt><dd>{profile?.email || 'Not added'}</dd></div></dl><p>Shown from the last server-confirmed save. New prints use current details; older printed copies remain as they were.</p></aside>
      </div>
    </>}
  </section>;
}
