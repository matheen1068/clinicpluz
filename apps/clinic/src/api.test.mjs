import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, getClinicBootstrap, getStaffSession, signIn, signOut } from './api.ts';

const session = {
  clinicSlug: 'goodwell',
  csrfToken: 'authenticated-csrf',
  user: { id: 'staff-1', displayName: 'Dr. A', role: 'doctor' },
};

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('bootstrap requires server-provided clinic identity and CSRF token', async () => {
  let restore = mockFetch(async (_path, options) => {
    assert.equal(options.credentials, 'include');
    return Response.json({ clinic: { slug: 'goodwell', displayName: 'Goodwell Clinic' }, csrfToken: 'browser-csrf' });
  });
  try {
    assert.equal((await getClinicBootstrap()).clinic.displayName, 'Goodwell Clinic');
  } finally { restore(); }

  restore = mockFetch(async () => Response.json({ clinic: { slug: 'goodwell' } }));
  try {
    await assert.rejects(getClinicBootstrap(), ApiError);
  } finally { restore(); }
});

test('session is absent on 401 but does not become a fake session on service failure', async () => {
  let restore = mockFetch(async () => new Response(null, { status: 401 }));
  try {
    assert.equal(await getStaffSession(), null);
  } finally { restore(); }

  restore = mockFetch(async () => { throw new Error('offline'); });
  try {
    await assert.rejects(getStaffSession(), ApiError);
  } finally { restore(); }
});

test('sign-in and sign-out use same-origin cookie requests and CSRF headers', async () => {
  const calls = [];
  const restore = mockFetch(async (path, options) => {
    calls.push({ path, options });
    return path === '/api/auth/login' ? Response.json(session) : new Response(null, { status: 204 });
  });
  try {
    assert.equal((await signIn('staff-a', 'private-password', 'browser-csrf')).user.id, 'staff-1');
    await signOut(session.csrfToken);
    assert.equal(calls[0].path, '/api/auth/login');
    assert.equal(calls[0].options.credentials, 'include');
    assert.equal(calls[0].options.headers['X-CSRF-Token'], 'browser-csrf');
    assert.deepEqual(JSON.parse(calls[0].options.body), { username: 'staff-a', password: 'private-password' });
    assert.equal(calls[1].path, '/api/auth/logout');
    assert.equal(calls[1].options.headers['X-CSRF-Token'], 'authenticated-csrf');
  } finally { restore(); }
});
