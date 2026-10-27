import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI_CHANGE_SECRET_PLACEHOLDER } from '@ts6/common';
import { classifyChange } from '../middleware/change-log-policy.js';
import { diffJson, SNAPSHOT_RULES, snapshotRuleFor, takeSnapshot, type SnapshotContext } from './change-log-snapshots.js';

/** A WebQuery client that answers each command from a table. */
function fakeClient(answers: Record<string, unknown>, calls: string[] = []) {
  return {
    execute: async (_sid: number, command: string) => {
      calls.push(command);
      if (!(command in answers)) throw new Error(`unexpected ${command}`);
      const a = answers[command];
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as SnapshotContext['client'];
}

async function run(method: string, pattern: string, ctx: Omit<SnapshotContext, 'client'>, answers: Record<string, unknown>) {
  const rule = snapshotRuleFor(method, pattern);
  assert.ok(rule, `no rule for ${method} ${pattern}`);
  const calls: string[] = [];
  const full = { ...ctx, client: fakeClient(answers, calls) };
  const json = diffJson(rule!, await takeSnapshot(rule!, full), full);
  return { diff: JSON.parse(json), json, calls };
}

test('every snapshot rule matches a pattern the change log really produces', () => {
  for (const rule of SNAPSHOT_RULES) {
    const url = '/api' + rule.pattern.replace(':configId', '1').replace(':sid', '1').replace(/:id/g, '7').replace(':token', 'abc').replace(':pw', 'def');
    const d = classifyChange(rule.method, url);
    assert.equal(d.kind === 'log' && d.target.routePattern, rule.pattern, `${rule.method} ${url}`);
  }
});

test('a channel edit keeps only the fields that differ, and a password only as changed', async () => {
  const { diff, calls } = await run('PUT', '/servers/:configId/vs/:sid/channels/:id', {
    sid: 1, leaf: ['7'], body: { channel_name: 'New', channel_topic: 'same', channel_password: 'Hunter2!' },
  }, { channelinfo: [{ channel_name: 'Old', channel_topic: 'same', channel_flag_password: '0' }] });
  assert.deepEqual(calls, ['channelinfo']); // exactly one read
  assert.deepEqual(diff.fields, [
    { field: 'channel_name', before: 'Old', after: 'New' },
    { field: 'channel_password', before: UI_CHANGE_SECRET_PLACEHOLDER, after: UI_CHANGE_SECRET_PLACEHOLDER },
  ]);
});

test('a permission change names only the touched permission, with "not set" as null', async () => {
  const pattern = '/servers/:configId/vs/:sid/server-groups/:id/permissions';
  const list = { servergrouppermlist: [{ permsid: 'i_client_talk_power', permvalue: '50', permnegated: '0', permskip: '1' }, { permsid: 'b_other', permvalue: '1', permnegated: '0', permskip: '0' }] };
  const set = await run('PUT', pattern, { sid: 1, leaf: ['6', 'permissions'], body: { permsid: 'i_client_talk_power', permvalue: 75, permnegated: 0, permskip: 1 } }, list);
  assert.deepEqual(set.diff.fields, [{ field: 'i_client_talk_power', before: '50 · skip', after: '75 · skip' }]);
  const added = await run('PUT', pattern, { sid: 1, leaf: ['6', 'permissions'], body: { permsid: 'i_new', permvalue: 1, permnegated: 0, permskip: 0 } }, list);
  assert.deepEqual(added.diff.fields, [{ field: 'i_new', before: null, after: '1' }]);
  const removed = await run('DELETE', pattern, { sid: 1, leaf: ['6', 'permissions'], body: { permsid: 'b_other' } }, list);
  assert.deepEqual(removed.diff.fields, [{ field: 'b_other', before: '1', after: null }]);
  const same = await run('PUT', pattern, { sid: 1, leaf: ['6', 'permissions'], body: { permsid: 'b_other', permvalue: 1, permnegated: 0, permskip: 0 } }, list);
  assert.deepEqual(same.diff.fields, []);
});

test('virtual server settings list only the fields the handler passes on', async () => {
  const { diff } = await run('PUT', '/servers/:configId/virtual-servers/:id', {
    sid: 0, leaf: ['1'], body: { virtualserver_name: 'B', virtualserver_maxclients: 32, not_a_setting: 'x' },
  }, { serverinfo: [{ virtualserver_name: 'A', virtualserver_maxclients: '32' }] });
  assert.deepEqual(diff.fields, [{ field: 'virtualserver_name', before: 'A', after: 'B' }]);
});

test('a deleted privilege key is kept without the key, and the key in the path is never stored', async () => {
  const key = 'Wq+8zK/pT1x=';
  const { diff, json } = await run('DELETE', '/servers/:configId/vs/:sid/tokens/:token', { sid: 1, leaf: [key], body: {} }, {
    privilegekeylist: [{ token: key, token_type: '0', token_id1: '8', token_description: 'for Anna' }, { token: 'other', token_id1: '9' }],
  });
  assert.deepEqual(diff.deleted, { token_type: '0', token_id1: '8', token_description: 'for Anna' });
  assert.ok(!json.includes(key));
});

test('a deleted temporary password is kept without the password', async () => {
  const { diff, json } = await run('DELETE', '/servers/:configId/vs/:sid/tokens/temp-passwords/:pw', { sid: 1, leaf: ['temp-passwords', '482913'], body: {} }, {
    servertemppasswordlist: [{ pw_clear: '482913', desc: 'event', tcid: '0' }],
  });
  assert.deepEqual(diff.deleted, { desc: 'event', tcid: '0' });
  assert.ok(!json.includes('482913'));
});

test('deleting all bans keeps the count and caps the list', async () => {
  const bans = Array.from({ length: 150 }, (_, i) => ({ banid: String(i), ip: `10.0.0.${i % 250}`, reason: 'r'.repeat(90) }));
  const { diff, json } = await run('DELETE', '/servers/:configId/vs/:sid/bans', { sid: 1, leaf: [], body: {} }, { banlist: bans });
  assert.equal(diff.deletedList.count, 150);
  assert.ok(diff.deletedList.items.length <= 100 && diff.deletedList.items.length > 0);
  assert.ok(json.length <= 16000);
});

test('a read that never answers gives up after the timeout', async () => {
  const rule = snapshotRuleFor('PUT', '/servers/:configId/instance')!;
  const hanging = { execute: () => new Promise(() => {}) } as unknown as SnapshotContext['client'];
  const started = Date.now();
  const snap = await takeSnapshot(rule, { client: hanging, sid: 0, leaf: [], body: {} });
  const took = Date.now() - started;
  assert.equal(snap.ok, false);
  assert.ok(took >= 2900 && took < 4500, `took ${took} ms`);
});

test('a read that fails leaves the change going ahead, marked unavailable', async () => {
  const { diff } = await run('PUT', '/servers/:configId/instance', { sid: 0, leaf: [], body: { serverinstance_serverquery_ban_time: 60 } }, {
    instanceinfo: new Error('flood protection'),
  });
  assert.equal(diff.unavailable, 'flood protection');
});
