import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banTimeAllows, evaluatePermissionAction, type PermissionActionInput } from '@ts6/common';

// The rules were measured live (see the header of permission-action.ts); these pin them.

type Row = { rank: number; permsid: string; permvalue: number; permnegated: number; permskip: number };
const r = (permsid: string, permvalue: number, rank = 2): Row => ({ rank, permsid, permvalue, permnegated: 0, permskip: 0 });
const base = (over: Partial<PermissionActionInput<Row>>): PermissionActionInput<Row> => ({
  action: 'kick-server', targetOnline: true, actorOnline: true, actorInOwnChannel: [], actorInTargetChannel: [], target: [], ...over,
});
const verdict = (over: Partial<PermissionActionInput<Row>>) => evaluatePermissionAction(base(over)).verdict;

const PAIRS = {
  'kick-server': ['i_client_kick_from_server_power', 'i_client_needed_kick_from_server_power'],
  'kick-channel': ['i_client_kick_from_channel_power', 'i_client_needed_kick_from_channel_power'],
  poke: ['i_client_poke_power', 'i_client_needed_poke_power'],
  'message-private': ['i_client_private_textmessage_power', 'i_client_needed_private_textmessage_power'],
} as const;

test('online-target pairs: power >= needed, read in the target channel', () => {
  for (const [action, [p, n]] of Object.entries(PAIRS)) {
    const target = [r(n, 50)];
    assert.equal(verdict({ action: action as any, actorInTargetChannel: [r(p, 49)], target }), 'denied', action);
    assert.equal(verdict({ action: action as any, actorInTargetChannel: [r(p, 50)], target }), 'allowed', action);
    assert.equal(verdict({ action: action as any, actorInTargetChannel: [r(p, 51)], target }), 'allowed', action);
    // power that only holds in the actor's own channel does not count
    assert.equal(verdict({ action: action as any, actorInOwnChannel: [r(p, 100)], actorInTargetChannel: [], target }), 'denied', action);
  }
});

test('unset counts as 0, and 0 vs 0 passes', () => {
  assert.equal(verdict({}), 'allowed');
  const res = evaluatePermissionAction(base({}));
  assert.equal(res.checks[0].have.source, null);
  assert.equal(res.checks[0].have.value, 0);
});

test('the deciding source is the resolved winner (tiers, negate)', () => {
  const p = 'i_client_kick_from_server_power';
  const res = evaluatePermissionAction(base({
    actorInTargetChannel: [r(p, 100, 1), { ...r(p, 10, 1), permnegated: 1 }, r(p, 30, 4)],
    target: [r('i_client_needed_kick_from_server_power', 20, 1)],
  }));
  assert.equal(res.checks[0].have.value, 30);
  assert.equal(res.checks[0].have.source?.rank, 4);
  assert.equal(res.verdict, 'allowed');
});

test('actions on a connected client are impossible when the target is offline', () => {
  for (const action of ['kick-server', 'kick-channel', 'move', 'poke', 'message-private'] as const) {
    const res = evaluatePermissionAction(base({ action, targetOnline: false, actorInTargetChannel: undefined }));
    assert.equal(res.verdict, 'impossible', action);
    assert.deepEqual(res.notes, ['target-offline']);
  }
});

test('move: power in the target channel and in the destination', () => {
  const p = 'i_client_move_power', n = 'i_client_needed_move_power';
  const target = [r(n, 50)];
  const mv = (src: number, dst: number) => verdict({ action: 'move', actorInTargetChannel: [r(p, src)], actorInDestination: [r(p, dst)], target });
  assert.equal(mv(50, 50), 'allowed');
  assert.equal(mv(50, 49), 'denied');
  assert.equal(mv(49, 50), 'denied');
  const res = evaluatePermissionAction(base({ action: 'move', actorInTargetChannel: [r(p, 60)], actorInDestination: [r(p, 60)], target }));
  assert.ok(res.notes.includes('move-join-not-checked'));
  assert.equal(verdict({ action: 'move', destinationIsTargetChannel: true }), 'impossible');
});

test('ban time: -1 = no limit, 0 = permanent needs -1, otherwise duration <= max', () => {
  assert.equal(banTimeAllows(10, 9), true);
  assert.equal(banTimeAllows(10, 10), true);
  assert.equal(banTimeAllows(10, 11), false);
  assert.equal(banTimeAllows(10, 0), false);
  assert.equal(banTimeAllows(-1, 0), true);
  assert.equal(banTimeAllows(-1, 99999), true);
  assert.equal(banTimeAllows(0, 0), false);
});

test('ban, online target: power pair + max ban time in the target channel, no ban_create', () => {
  const P = 'i_client_ban_power', N = 'i_client_needed_ban_power', M = 'i_client_ban_max_bantime';
  const target = [r(N, 50)];
  assert.equal(verdict({ action: 'ban', banDuration: 10, actorInTargetChannel: [r(P, 50), r(M, 10)], target }), 'allowed');
  assert.equal(verdict({ action: 'ban', banDuration: 10, actorInTargetChannel: [r(P, 49), r(M, 10)], target }), 'denied');
  assert.equal(verdict({ action: 'ban', banDuration: 11, actorInTargetChannel: [r(P, 50), r(M, 10)], target }), 'denied');
  // max ban time only in the actor's own channel does not count for an online target
  assert.equal(verdict({ action: 'ban', banDuration: 10, actorInOwnChannel: [r(M, -1)], actorInTargetChannel: [r(P, 50)], target }), 'denied');
  const res = evaluatePermissionAction(base({ action: 'ban', banDuration: 10, actorInTargetChannel: [r(P, 50), r(M, 10)], target }));
  assert.deepEqual(res.checks.map((c) => c.kind), ['power', 'ban-time']);
});

test('ban, offline target: ban_create + max ban time in the actor channel, no power pair', () => {
  const C = 'b_client_ban_create', M = 'i_client_ban_max_bantime';
  const off = { action: 'ban' as const, targetOnline: false, actorInTargetChannel: undefined, banDuration: 10, target: [r('i_client_needed_ban_power', 99)] };
  assert.equal(verdict({ ...off, actorInOwnChannel: [r(C, 1), r(M, 100)] }), 'allowed');
  assert.equal(verdict({ ...off, actorInOwnChannel: [r(C, 0), r(M, 100)] }), 'denied');
  assert.equal(verdict({ ...off, actorInOwnChannel: [r(C, 1), r(M, 5)] }), 'denied');
});

test('group add/remove: member power vs the group, permission modify vs the target (tiers 1-2 only), actor channel', () => {
  for (const [action, p, n] of [['group-add', 'i_group_member_add_power', 'i_group_needed_member_add_power'],
    ['group-remove', 'i_group_member_remove_power', 'i_group_needed_member_remove_power']] as const) {
    const member = action === 'group-remove';
    const group = { sgid: 9, perms: [{ permsid: n, permvalue: 50 }], targetIsMember: member };
    const g = (power: number, modify: number, targetRows: Row[] = [], own = true) => verdict({
      action, group, target: targetRows,
      actorInOwnChannel: own ? [r(p, power), r('i_client_permission_modify_power', modify)] : [],
      actorInTargetChannel: own ? [] : [r(p, power), r('i_client_permission_modify_power', modify)],
    });
    assert.equal(g(50, 0), 'allowed', action);
    assert.equal(g(49, 0), 'denied', action);
    assert.equal(g(100, 49, [r('i_client_needed_permission_modify_power', 50)]), 'denied', action);
    assert.equal(g(100, 50, [r('i_client_needed_permission_modify_power', 50)]), 'allowed', action);
    // the target's channel group / channel-client value is ignored
    assert.equal(g(100, 60, [r('i_client_needed_permission_modify_power', 70, 4), r('i_client_needed_permission_modify_power', 70, 5)]), 'allowed', action);
    // power that only holds in the target's channel does not count
    assert.equal(g(100, 100, [], false), 'denied', action);
  }
});

test('group add on a member / remove of a non-member is impossible, checks still listed', () => {
  const res = evaluatePermissionAction(base({ action: 'group-add', group: { sgid: 1, perms: [], targetIsMember: true } }));
  assert.equal(res.verdict, 'impossible');
  assert.deepEqual(res.notes, ['already-member']);
  assert.equal(res.checks.length, 2);
  assert.equal(evaluatePermissionAction(base({ action: 'group-remove', group: { sgid: 1, perms: [], targetIsMember: false } })).notes[0], 'not-member');
});

test('an offline actor is flagged', () => {
  assert.ok(evaluatePermissionAction(base({ actorOnline: false })).notes.includes('actor-offline-default-channel'));
});
