import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveClinicSlug } from './tenant.ts';

test('resolves exactly one clinic label for production and staging domains', () => {
  assert.equal(resolveClinicSlug('goodwell.clinicpluz.com', 'clinicpluz.com', false), 'goodwell');
  assert.equal(resolveClinicSlug('blesswell.staging.clinicpluz.com', 'staging.clinicpluz.com', false), 'blesswell');
  assert.equal(resolveClinicSlug('goodwell.other.com', 'clinicpluz.com', false), null);
  assert.equal(resolveClinicSlug('foo.bar.clinicpluz.com', 'clinicpluz.com', false), null);
});

test('allows named localhost clinics for development only', () => {
  assert.equal(resolveClinicSlug('goodwell.localhost', undefined, true), 'goodwell');
  assert.equal(resolveClinicSlug('goodwell.localhost', undefined, false), null);
  assert.equal(resolveClinicSlug('localhost', undefined, true), null);
});

test('fails closed for reserved and malformed clinic names', () => {
  for (const host of ['admin.clinicpluz.com', '-clinic.clinicpluz.com', 'clinic-.clinicpluz.com', 'foo.bar.clinicpluz.com', 'clinicpluz.com']) {
    assert.equal(resolveClinicSlug(host, 'clinicpluz.com', false), null, host);
  }
  assert.equal(resolveClinicSlug('goodwell.clinicpluz.com', undefined, false), null);
});
