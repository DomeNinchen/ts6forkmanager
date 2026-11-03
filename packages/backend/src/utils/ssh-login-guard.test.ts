import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SshQueryClient } from '../bot-engine/ssh-query-client.js';
import { claimTestLogin, forgetSshRejection, oneLoginAtATime, rememberSshRejection, sshRejection, TEST_LOGIN_INTERVAL_MS } from './ssh-login-guard.js';

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

test('parallel logins with the same credentials run one after another', async () => {
  const c = { host: 'h', port: 1, username: 'u', password: 'p' };
  const order: string[] = [];
  const login = (name: string, fail: boolean) => async () => {
    order.push(`${name} start`);
    await new Promise(r => setTimeout(r, 10));
    order.push(`${name} end`);
    if (fail) throw new Error('refused');
  };
  const results = await Promise.allSettled([
    oneLoginAtATime(c, login('a', true)),
    oneLoginAtATime(c, login('b', false)),
    oneLoginAtATime({ ...c, password: 'other' }, login('x', false)),
  ]);
  assert.deepEqual(results.map(r => r.status), ['rejected', 'fulfilled', 'fulfilled']);
  assert.ok(order.indexOf('b start') > order.indexOf('a end'));
  assert.ok(order.indexOf('x start') < order.indexOf('a end')); // other credentials do not wait
});

test('SshQueryClient does not open a connection for refused credentials', async () => {
  // TEST-NET address: a real attempt would time out instead of failing at once.
  const c = { host: '192.0.2.1', port: 1, username: 'u', password: 'refused-before' };
  rememberSshRejection(c, 'All configured authentication methods failed');
  const client = new SshQueryClient(c);
  const started = Date.now();
  await assert.rejects(client.connect(), (err: any) => err.level === 'client-authentication' && /not retried/.test(err.message));
  assert.ok(Date.now() - started < 100);
  assert.equal(client.hasFatalError, true);
  await client.destroy();
  forgetSshRejection(c);
});
