import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClinicProfileApiError, getClinicProfile, profileUpdate, removeClinicLogo,
  saveClinicProfile, uploadClinicLogo, validateProfileDraft,
} from './clinicProfileApi.ts';

const profile = {
  slug: 'goodwell', displayName: 'Goodwell Clinic', address: null, phone: null, email: null,
  revision: 0, logo: null,
};
const logoUrl = '/api/workflow/clinics/goodwell/profile/logo';
function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('profile read uses the authenticated clinic route and accepts a missing revision-zero profile', async () => {
  const restore = mockFetch(async (path, init) => {
    assert.equal(path, '/api/workflow/clinics/goodwell/profile');
    assert.equal(init.credentials, 'include');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.mode, 'same-origin');
    return Response.json({ profile, canEdit: false });
  });
  try {
    const value = await getClinicProfile('goodwell');
    assert.equal(value.profile.revision, 0);
    assert.equal(value.canEdit, false);
  } finally { restore(); }
});

test('full profile save clears optional fields and requires an authenticated CSRF token', async () => {
  const draft = { displayName: ' Goodwell Care ', address: ' ', phone: '', email: ' INFO@EXAMPLE.TEST ' };
  const expected = { expectedRevision: 3, displayName: 'Goodwell Care', address: null, phone: null, email: 'info@example.test' };
  assert.deepEqual(profileUpdate(draft, 3), expected);
  const restore = mockFetch(async (path, init) => {
    assert.equal(path, '/api/workflow/clinics/goodwell/profile');
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['X-CSRF-Token'], 'csrf-session');
    assert.deepEqual(JSON.parse(init.body), expected);
    return Response.json({ profile: { ...profile, ...expected, revision: 4 }, canEdit: true });
  });
  try {
    assert.equal((await saveClinicProfile('goodwell', draft, 3, 'csrf-session')).profile.revision, 4);
    await assert.rejects(saveClinicProfile('goodwell', draft, 3, ''), ClinicProfileApiError);
  } finally { restore(); }
});

test('logo upload and removal use bounded same-origin routes and revision checks', async () => {
  let calls = 0;
  const restore = mockFetch(async (path, init) => {
    assert.equal(path, logoUrl);
    assert.equal(init.headers['X-CSRF-Token'], 'csrf-session');
    const body = JSON.parse(init.body);
    if (++calls === 1) {
      assert.equal(init.method, 'POST');
      assert.deepEqual(body, { expectedRevision: 4, contentType: 'image/png', dataBase64: 'AQID' });
      return Response.json({ profile: { ...profile, revision: 5, logo: { url: logoUrl, contentType: 'image/png' } }, canEdit: true });
    }
    assert.equal(init.method, 'DELETE');
    assert.deepEqual(body, { expectedRevision: 5 });
    return Response.json({ profile: { ...profile, revision: 6 }, canEdit: true });
  });
  try {
    const uploaded = await uploadClinicLogo('goodwell', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }), 4, 'csrf-session');
    assert.equal(uploaded.profile.logo.url, logoUrl);
    assert.equal((await removeClinicLogo('goodwell', 5, 'csrf-session')).profile.logo, null);
    assert.equal(calls, 2);
    await assert.rejects(uploadClinicLogo('goodwell', new File([new Uint8Array(3_000_001)], 'large.png', { type: 'image/png' }), 6, 'csrf-session'), ClinicProfileApiError);
    assert.equal(calls, 2);
  } finally { restore(); }
});

test('logo upload accepts a file larger than the old 128 KiB limit', async () => {
  let sent = false;
  const restore = mockFetch(async (_path, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.dataBase64.length, 4 * Math.ceil((128 * 1024 + 1) / 3));
    sent = true;
    return Response.json({ profile: { ...profile, revision: 1 }, canEdit: true });
  });
  try {
    await uploadClinicLogo('goodwell', new File([new Uint8Array(128 * 1024 + 1)], 'logo.png', { type: 'image/png' }), 0, 'csrf-session');
    assert.equal(sent, true);
  } finally { restore(); }
});

test('profile parser rejects cross-clinic records, external images and malformed edit rights', async () => {
  for (const response of [
    { profile: { ...profile, slug: 'blesswell' }, canEdit: true },
    { profile: { ...profile, logo: { url: 'https://other.example/logo.png', contentType: 'image/png' } }, canEdit: true },
    { profile, canEdit: 'yes' },
  ]) {
    const restore = mockFetch(async () => Response.json(response));
    try { await assert.rejects(getClinicProfile('goodwell'), ClinicProfileApiError); }
    finally { restore(); }
  }
});

test('profile validation catches unsupported contact details before sending', () => {
  const base = { displayName: 'Goodwell', address: '', phone: '', email: '' };
  assert.equal(validateProfileDraft(base), null);
  assert.match(validateProfileDraft({ ...base, displayName: 'X' }), /clinic name/);
  assert.match(validateProfileDraft({ ...base, phone: '123' }), /7 to 15 digits/);
  assert.match(validateProfileDraft({ ...base, email: 'not-an-email' }), /valid contact email/);
  assert.match(validateProfileDraft({ ...base, address: 'X'.repeat(301) }), /300 characters/);
});
