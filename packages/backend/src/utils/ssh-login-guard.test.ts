import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimTestLogin, forgetSshRejection, rememberSshRejection, sshRejection, TEST_LOGIN_INTERVAL_MS } from './ssh-login-guard.js';

test('a refused login is remembered for exactly those credentials', () => {
  const c = { host: 'Ts.Example', port: 10022, username: 'serveradmin', password: 'wrong' };
  rememberSshRejection(c, 'All configured authentication methods failed');
  assert.equal(sshRejection({ ...c, host: 'ts.example' })?.message, 'All configured authentication methods failed');
  assert.equal(sshRejection({ ...c, password: 'changed' }), undefined);
  forgetSshRejection(c);
  assert.equal(sshRejection(c), undefined);
});

test('test logins to one target are spaced', () => {
  const t0 = 1_000_000;
  assert.equal(claimTestLogin('h', 1, t0), 0);
  assert.equal(claimTestLogin('h', 1, t0 + 1000), 29);
  assert.equal(claimTestLogin('h', 2, t0 + 1000), 0); // another target
  assert.equal(claimTestLogin('h', 1, t0 + TEST_LOGIN_INTERVAL_MS), 0);
});
