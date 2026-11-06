import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_QUEUE_DEFAULTS, supportRoomName, supportSettingsProblem, type SupportQueueSettings } from '@ts6/common';
import { orderOpenCases, parseClientList, parseSettings, reconcile, type ListedClient, type OpenCase, type ReconcileInput } from './support-queue.js';
import { findQueueConflicts } from '../routes/support-queue.routes.js';

const WAIT = 10;
const SUP_GROUP = 50;
const AFK = 99;
const settings: SupportQueueSettings = { ...SUPPORT_QUEUE_DEFAULTS, supporterGroupIds: [SUP_GROUP], afkChannelIds: [AFK], graceSec: 60 };
const T0 = 1_800_000_000_000;

let nextClid = 1;
function cl(uid: string, cid: number, extra: Partial<ListedClient> = {}): ListedClient {
  return { clid: nextClid++, uid, cldbid: uid.length * 7, nickname: uid, cid, groups: [8], away: false, ...extra };
}
const sup = (uid: string, cid: number, extra: Partial<ListedClient> = {}) => cl(uid, cid, { groups: [8, SUP_GROUP], ...extra });
function open(id: number, uid: string, state: OpenCase['state'], absentSince: number | null = null): OpenCase {
  return { id, clientUid: uid, cldbid: uid.length * 7, nickname: uid, state, absentSince };
}
function run(cases: OpenCase[], clients: ListedClient[], extra: Partial<ReconcileInput> = {}) {
  return reconcile({ channelId: WAIT, settings, cases, clients, now: T0, watchingSince: T0 - 3_600_000, firstLook: false, ...extra });
}

test('parseClientList keeps voice clients only and reads uid, groups and away', () => {
  const rows = [
    { clid: '3', cid: '213', client_database_id: '1325', client_nickname: 'A', client_type: '0', client_unique_identifier: 'u1', client_servergroups: '56,7', client_away: '1' },
    { clid: '4', cid: '1', client_database_id: '1', client_nickname: 'TS6Manager', client_type: '1', client_unique_identifier: 'q', client_servergroups: '2', client_away: '0' },
  ];
  assert.deepEqual(parseClientList(rows), [{ clid: 3, uid: 'u1', cldbid: 1325, nickname: 'A', cid: 213, groups: [56, 7], away: true }]);
});

test('new clients in the waiting channel are queued; supporters and other channels are not', () => {
  const ch = run([], [cl('a', WAIT), sup('s', WAIT), cl('b', 5)]);
  assert.deepEqual(ch, [{ kind: 'create', uid: 'a', cldbid: 7, nickname: 'a', arrivalUnknown: false }]);
});

test('positive control: nobody in the waiting channel means no case at all', () => {
  assert.deepEqual(run([], [cl('a', 5), sup('s', 5)]), []);
});

test('first look after a start marks the arrival as unknown; a known case is not created twice', () => {
  const ch = run([open(1, 'a', 'waiting')], [cl('a', WAIT), cl('b', WAIT)], { firstLook: true });
  assert.deepEqual(ch, [{ kind: 'create', uid: 'b', cldbid: 7, nickname: 'b', arrivalUnknown: true }]);
});

test('two connections of one identity give one case', () => {
  const ch = run([], [cl('a', 5), cl('a', WAIT)]);
  assert.equal(ch.length, 1);
});

test('with queueWithoutSupporter off, nobody is queued while no supporter is available', () => {
  const off = { settings: { ...settings, queueWithoutSupporter: false } };
  assert.deepEqual(run([], [cl('a', WAIT), sup('away', 3, { away: true }), sup('afk', AFK)], off), []);
  assert.equal(run([], [cl('a', WAIT), sup('s', 3)], off).length, 1);
});

test('a waiting client that leaves starts the grace period, keeps the place within it, is cancelled after it', () => {
  // just left: absentSince set
  assert.deepEqual(run([open(1, 'a', 'waiting')], []), [{ kind: 'update', id: 1, from: 'waiting', data: { absentSince: T0 } }]);
  // still within the grace period: nothing
  assert.deepEqual(run([open(1, 'a', 'waiting', T0 - 59_000)], []), []);
  // back within it: absentSince cleared, no new case
  assert.deepEqual(run([open(1, 'a', 'waiting', T0 - 59_000)], [cl('a', WAIT)]), [{ kind: 'update', id: 1, from: 'waiting', data: { absentSince: null } }]);
  // gone past it: cancelled, and the reason tells offline from another channel
  assert.deepEqual(run([open(1, 'a', 'waiting', T0 - 60_000)], []), [{ kind: 'update', id: 1, from: 'waiting', data: { state: 'cancelled', endedAt: T0, endReason: 'left-server' } }]);
  const other = run([open(1, 'a', 'waiting', T0 - 60_000)], [cl('a', 5)]);
  assert.equal((other[0] as any).data.endReason, 'left-channel');
});

test('after the grace period a returning client is a new case (the old one is cancelled in the same pass)', () => {
  // The old case still holds the uid in this pass, so no second case; the next pass (no open case) creates it.
  const first = run([open(1, 'a', 'waiting', T0 - 61_000)], [cl('a', 5)]);
  assert.equal((first[0] as any).data.state, 'cancelled');
  assert.deepEqual(run([], [cl('a', WAIT)]).map((c) => c.kind), ['create']);
});

test('the grace period counts from the start of watching, so an outage does not cancel anyone at once', () => {
  // absent since an hour, but watching only started 10 s ago (resumed after an outage): not cancelled yet
  assert.deepEqual(run([open(1, 'a', 'waiting', T0 - 3_600_000)], [], { watchingSince: T0 - 10_000 }), []);
  assert.equal((run([open(1, 'a', 'waiting', T0 - 3_600_000)], [], { watchingSince: T0 - 60_000 })[0] as any).data.state, 'cancelled');
});

test('a waiting client moved to a channel with a supporter is taken; every supporter there is credited', () => {
  const s1 = sup('s1', 3);
  const s2 = sup('s2', 3);
  const ch = run([open(1, 'a', 'waiting')], [cl('a', 3), s1, s2, sup('elsewhere', 4)]);
  assert.deepEqual(ch, [{
    kind: 'update', id: 1, from: 'waiting',
    data: { state: 'in-progress', absentSince: null, takenAt: T0, takenBy: [s1, s2].map((s) => ({ uid: s.uid, nickname: s.nickname, cldbid: s.cldbid })), takenVia: 'teamspeak' },
  }]);
});

test('a supporter walking into the waiting channel takes nobody, and an AFK supporter takes nobody', () => {
  assert.deepEqual(run([open(1, 'a', 'waiting'), open(2, 'b', 'waiting')], [cl('a', WAIT), cl('b', WAIT), sup('s', WAIT)]), []);
  const afk = run([open(1, 'a', 'waiting')], [cl('a', AFK), sup('s', AFK)]);
  assert.deepEqual(afk, [{ kind: 'update', id: 1, from: 'waiting', data: { absentSince: T0 } }]);
});

test('a taken case goes on while the client is with a supporter and is done after the grace period without one', () => {
  assert.deepEqual(run([open(1, 'a', 'in-progress')], [cl('a', 3), sup('s', 3)]), []);
  assert.deepEqual(run([open(1, 'a', 'in-progress')], [cl('a', 3), sup('s', 4)]), [{ kind: 'update', id: 1, from: 'in-progress', data: { absentSince: T0 } }]);
  assert.deepEqual(run([open(1, 'a', 'in-progress', T0 - 60_000)], [cl('a', 3)]), [{ kind: 'update', id: 1, from: 'in-progress', data: { state: 'done', endedAt: T0, endReason: 'finished' } }]);
  assert.equal((run([open(1, 'a', 'in-progress', T0 - 60_000)], [])[0] as any).data.endReason, 'left-server');
  // a supporter coming back within the grace period keeps it going
  assert.deepEqual(run([open(1, 'a', 'in-progress', T0 - 30_000)], [cl('a', 3), sup('s', 3)]), [{ kind: 'update', id: 1, from: 'in-progress', data: { absentSince: null } }]);
});

test('a taken client back alone in the waiting channel is not queued again until the taken case has ended', () => {
  const ch = run([open(1, 'a', 'in-progress')], [cl('a', WAIT)]);
  assert.deepEqual(ch.map((c) => c.kind), ['update']);
});

test('a renamed client keeps the case and the new nickname is stored', () => {
  assert.deepEqual(run([open(1, 'a', 'waiting')], [cl('a', WAIT, { nickname: 'Alice' })]), [{ kind: 'update', id: 1, from: 'waiting', data: { nickname: 'Alice', cldbid: 7 } }]);
});

test('positions: by arrival, ties by id; taken cases follow without a position', () => {
  const row = (id: number, state: string, at: number) => ({
    id, queueId: 1, clientUid: `u${id}`, cldbid: id, nickname: `n${id}`, arrivedAt: new Date(at), arrivalUnknown: false, state,
    absentSince: null, takenAt: null, takenBy: null, takenVia: null, actedBy: null, roomCid: null, endedAt: null, endReason: null,
  });
  const out = orderOpenCases([row(5, 'in-progress', 1), row(3, 'waiting', 200), row(2, 'waiting', 100), row(1, 'waiting', 200)] as any);
  assert.deepEqual(out.map((c) => [c.id, c.position]), [[2, 1], [1, 2], [3, 3], [5, null]]);
});

test('settings: broken or invalid JSON falls back to the defaults; validation names the field', () => {
  assert.deepEqual(parseSettings('{oops'), SUPPORT_QUEUE_DEFAULTS);
  assert.deepEqual(parseSettings(JSON.stringify({ graceSec: -1 })), SUPPORT_QUEUE_DEFAULTS);
  assert.equal(parseSettings(JSON.stringify({ graceSec: 5 })).graceSec, 5);
  assert.match(supportSettingsProblem({ ...settings, graceSec: 3601 })!, /graceSec/);
  assert.match(supportSettingsProblem({ ...settings, supporterGroupIds: [0] })!, /supporterGroupIds/);
  assert.match(supportSettingsProblem({ ...settings, roomName: 'x'.repeat(41) })!, /roomName/);
  assert.equal(supportSettingsProblem(settings), null);
});

test('room name: placeholders filled and cut to the channel name limit', () => {
  assert.equal(supportRoomName('Support: {client} / {supporter}', 'Alice', 'Bob'), 'Support: Alice / Bob');
  assert.equal([...supportRoomName('{client}', 'ä'.repeat(60), '')].length, 40);
});

test('conflicts: the support template on the same channel and a move trigger comparing ctid are found', async () => {
  const flows = [
    { id: 1, name: 'tpl', flowData: JSON.stringify({ template: { id: 'support-system', config: { supportChannelId: 15 } }, nodes: [] }) },
    { id: 2, name: 'own', flowData: JSON.stringify({ nodes: [{ type: 'trigger_event', config: { eventName: 'notifyclientmoved' } }, { type: 'condition', config: { expression: 'event.ctid == 15' } }] }) },
    { id: 3, name: 'other channel', flowData: JSON.stringify({ nodes: [{ type: 'trigger_event', config: { eventName: 'notifyclientmoved' } }, { type: 'condition', config: { expression: 'event.ctid == 151' } }] }) },
    { id: 4, name: 'no move trigger', flowData: JSON.stringify({ nodes: [{ type: 'trigger_cron', config: {} }, { type: 'condition', config: { expression: 'event.ctid == 15' } }] }) },
    { id: 5, name: 'broken', flowData: '{' },
  ];
  const prisma = { botFlow: { findMany: async () => flows } } as any;
  assert.deepEqual(await findQueueConflicts(prisma, 1, 1, 15), [{ flowId: 1, name: 'tpl' }, { flowId: 2, name: 'own' }]);
  assert.deepEqual(await findQueueConflicts(prisma, 1, 1, 0), []);
});
