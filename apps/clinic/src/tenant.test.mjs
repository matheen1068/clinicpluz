import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveClinicContext } from './tenant.ts';

test('owned-domain login resolves exactly one clinic label', () => {
  assert.deepEqual(resolveClinicContext('goodwell.clinicpluz.com', '/login/', 'clinicpluz.com', undefined, false),
    { slug: 'goodwell', mode: 'subdomain' });
  assert.deepEqual(resolveClinicContext('goodwell.clinicpluz.com', '/login', 'clinicpluz.com', undefined, false),
    { slug: 'goodwell', mode: 'subdomain' });
  assert.deepEqual(resolveClinicContext('blesswell.staging.clinicpluz.com', '/login/', 'staging.clinicpluz.com', undefined, false),
    { slug: 'blesswell', mode: 'subdomain' });
  assert.equal(resolveClinicContext('goodwell.other.com', '/login/', 'clinicpluz.com', undefined, false), null);
  assert.equal(resolveClinicContext('foo.bar.clinicpluz.com', '/login/', 'clinicpluz.com', undefined, false), null);
  assert.equal(resolveClinicContext('goodwell.clinicpluz.com', '/clinic/blesswell/login/', 'clinicpluz.com', undefined, false), null);
});

test('local development supports named subdomains and a path-based preview', () => {
  assert.deepEqual(resolveClinicContext('goodwell.localhost', '/login/', undefined, undefined, true),
    { slug: 'goodwell', mode: 'subdomain' });
  assert.deepEqual(resolveClinicContext('localhost', '/clinic/blesswell/login/', undefined, undefined, true),
    { slug: 'blesswell', mode: 'demo-path' });
  assert.equal(resolveClinicContext('localhost', '/login/', undefined, undefined, true), null);
  assert.equal(resolveClinicContext('goodwell.localhost', '/login/', undefined, undefined, false), null);
});

test('an explicitly approved CloudFront default hostname accepts only the clinic path', () => {
  assert.deepEqual(resolveClinicContext('d123abc.cloudfront.net', '/clinic/goodwell/login/', undefined, 'd123abc.cloudfront.net', false),
    { slug: 'goodwell', mode: 'demo-path' });
  assert.deepEqual(resolveClinicContext('d123abc.cloudfront.net', '/clinic/goodwell/login', undefined, 'd123abc.cloudfront.net', false),
    { slug: 'goodwell', mode: 'demo-path' });
  for (const host of ['dother.cloudfront.net', 'example.com']) {
    assert.equal(resolveClinicContext(host, '/clinic/goodwell/login/', undefined, 'd123abc.cloudfront.net', false), null);
  }
  assert.equal(resolveClinicContext('d123abc.cloudfront.net', '/login/', undefined, 'd123abc.cloudfront.net', false), null);
  assert.equal(resolveClinicContext('d123abc.cloudfront.net', '/clinic/goodwell/login/', undefined, undefined, false), null);
  assert.equal(resolveClinicContext('d123abc.cloudfront.net', '/clinic/goodwell/login/', undefined, 'other.com', false), null);
});

test('reserved and malformed clinic names fail closed in every mode', () => {
  for (const slug of ['admin', '-clinic', 'clinic-', 'foo/bar', 'foo.bar']) {
    assert.equal(resolveClinicContext('d123abc.cloudfront.net', `/clinic/${slug}/login/`, undefined, 'd123abc.cloudfront.net', false), null, slug);
  }
  assert.equal(resolveClinicContext('admin.clinicpluz.com', '/login/', 'clinicpluz.com', undefined, false), null);
  assert.equal(resolveClinicContext('clinicpluz.com', '/login/', 'clinicpluz.com', undefined, false), null);
});
