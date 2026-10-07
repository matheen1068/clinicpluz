import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./clinic-spa-rewrite.js', import.meta.url), 'utf8');
const handler = runInNewContext(`${source}\nhandler`);

function rewrite(method, uri) {
  return handler({ request: { method, uri } }).uri;
}

test('routes clinic login URLs to the app entry point', () => {
  assert.equal(rewrite('GET', '/clinic/goodwell/login/'), '/index.html');
  assert.equal(rewrite('HEAD', '/clinic/blesswell/login'), '/index.html');
});

test('leaves API, assets, invalid and reserved clinics untouched', () => {
  assert.equal(rewrite('GET', '/api/clinics/goodwell/bootstrap'), '/api/clinics/goodwell/bootstrap');
  assert.equal(rewrite('GET', '/assets/main.js'), '/assets/main.js');
  assert.equal(rewrite('GET', '/clinic/admin/login/'), '/clinic/admin/login/');
  assert.equal(rewrite('GET', '/clinic/goodwell.evil/login/'), '/clinic/goodwell.evil/login/');
  assert.equal(rewrite('GET', '/clinic/goodwell/'), '/clinic/goodwell/');
  assert.equal(rewrite('POST', '/clinic/goodwell/login/'), '/clinic/goodwell/login/');
});
