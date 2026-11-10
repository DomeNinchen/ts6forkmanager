import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORT_QUEUE_DEFAULTS, renderSupportText, supportEstimateMin, supportSettingsProblem, supportStats,
  type SupportCaseEntry, type SupportQueueSettings,
} from '@ts6/common';
import { NOTICES_PER_PASS, noticesFor, processQueueNotices, sendCost, type CaseForNotices } from './support-queue-notices.js';
import type { ListedClient } from './support-queue.js';

const WAIT = 10;
const T0 = 1_800_000_000_000;
const s: SupportQueueSettings = { ...SUPPORT_QUEUE_DEFAULTS, supporterGroupIds: [50] };
const cl = (uid: string, clid: number, cid: number, extra: Partial<ListedClient> = {}): ListedClient =>
  ({ clid, uid, cldbid: clid, nickname: uid, cid, groups: [8], away: false, ...extra });
const sup = (uid: string, clid: number, cid = 3) => cl(uid, clid, cid, { groups: [50] });
const k = (extra: Partial<CaseForNotices> = {}): CaseForNotices =>
  ({ id: 1, state: 'waiting', clientUid: 'a', nickname: 'Alice', arrivedAt: T0, takenBy: [], position: 2, notices: {}, ...extra });
const ctx = (extra: Partial<Parameters<typeof noticesFor>[2]> = {}) =>
  ({ channelId: WAIT, clients: [cl('a', 7, WAIT), sup('s1', 20), sup('s2', 21)], available: [sup('s1', 20), sup('s2', 21)], waitingCount: 3, estimateMin: null, now: T0, ...extra });

test('on entering: the client gets the position, every available supporter a poke', () => {
  const { sends, next } = noticesFor(k(), s, ctx());
  assert.deepEqual(sends, [
    { to: 'client', kind: 'enter', clid: 7, text: 'Hello Alice, you are number 2 in the support queue.' },
    { to: 'supporters', kind: 'poke', clids: [20, 21], text: 'Support: Alice is waiting (number 2)' },
  ]);
  assert.deepEqual(next, { enter: T0, last: T0, poked: true });
  assert.equal(sendCost(sends), 3);
});

test('the usual waiting time is added only when there is one', () => {
  assert.match(noticesFor(k(), s, ctx({ estimateMin: 4 })).sends[0].text, /number 2 in the support queue\. Usual waiting time: about 4 min\.$/);
  assert.equal(noticesFor(k(), { ...s, estimateText: '' }, ctx({ estimateMin: 4 })).sends[0].text, 'Hello Alice, you are number 2 in the support queue.');
});

test('no supporter available: the honest text, and the poke waits until one is there', () => {
  const none = noticesFor(k(), s, ctx({ available: [] }));
  assert.equal(none.sends.length, 1);
  assert.match(none.sends[0].text, /No supporter is available right now/);
  assert.equal(none.next.poked, undefined);
  const later = noticesFor(k({ notices: none.next }), s, ctx({ now: T0 + 30_000 }));
  assert.deepEqual(later.sends.map((x) => x.kind), ['poke']);
});

test('nothing is sent twice (restart safe), and nothing to a client outside the waiting channel', () => {
  const done = { enter: T0, last: T0, poked: true };
  assert.deepEqual(noticesFor(k({ notices: done }), s, ctx({ now: T0 + 3_600_000 })).sends, []);
  const away = noticesFor(k(), s, ctx({ clients: [cl('a', 7, 99)] }));
  assert.deepEqual(away.sends.map((x) => x.kind), ['poke']);
  assert.equal(away.next.enter, undefined);
});

test('with messages off nothing goes to the client, but the case is marked so switching on later greets nobody old', () => {
  const r = noticesFor(k(), { ...s, clientMessages: false, pokeSupporters: false }, ctx());
  assert.deepEqual(r.sends, []);
  assert.deepEqual(r.next, { enter: T0, last: T0, poked: true });
});

test('repeat every N minutes, only when switched on', () => {
  const n = { enter: T0, last: T0, poked: true };
  assert.deepEqual(noticesFor(k({ notices: n }), { ...s, repeatMin: 5 }, ctx({ now: T0 + 299_000 })).sends, []);
  const r = noticesFor(k({ notices: n, position: 1 }), { ...s, repeatMin: 5 }, ctx({ now: T0 + 300_000 }));
  assert.deepEqual(r.sends.map((x) => [x.kind, x.text]), [['repeat', 'Hello Alice, you are number 1 in the support queue.']]);
  assert.equal(r.next.last, T0 + 300_000);
});

test('reminder once after N minutes, only when switched on (default off)', () => {
  const n = { enter: T0, last: T0, poked: true };
  assert.deepEqual(noticesFor(k({ notices: n }), s, ctx({ now: T0 + 3_600_000 })).sends, []);
  const on = { ...s, remind: true, remindAfterMin: 5 };
  assert.deepEqual(noticesFor(k({ notices: n }), on, ctx({ now: T0 + 299_000 })).sends, []);
  const r = noticesFor(k({ notices: n }), on, ctx({ now: T0 + 300_000 }));
  assert.deepEqual(r.sends, [{ to: 'supporters', kind: 'remind', clids: [20, 21], text: 'Support: Alice has been waiting for 5 min' }]);
  assert.deepEqual(noticesFor(k({ notices: r.next }), on, ctx({ now: T0 + 900_000 })).sends, []);
});

test('taken: one message naming the supporters; none for a case from before the update', () => {
  const taken = k({ state: 'in-progress', position: null, takenBy: [{ uid: 's1', nickname: 'Bob', cldbid: 1 }], notices: { enter: T0, poked: true } });
  const r = noticesFor(taken, s, ctx({ clients: [cl('a', 7, 3)] }));
  assert.deepEqual(r.sends, [{ to: 'client', kind: 'taken', clid: 7, text: 'Hello Alice, Bob is taking care of you now.' }]);
  assert.deepEqual(noticesFor({ ...taken, notices: r.next }, s, ctx()).sends, []);
  assert.deepEqual(noticesFor({ ...taken, notices: {} }, s, ctx()).sends, []);
});

test('texts: placeholders filled, unknown kept, cut to the limit; pokes cut at 100', () => {
  assert.equal(renderSupportText('{client} #{position} {nope}', { client: 'A', position: 3 }, 100), 'A #3 {nope}');
  assert.equal([...renderSupportText('x'.repeat(150), {}, 100)].length, 100);
  const long = noticesFor(k({ nickname: 'N'.repeat(120) }), s, ctx());
  assert.equal([...long.sends[1].text].length, 100);
});

test('settings: the new fields are validated', () => {
  assert.equal(supportSettingsProblem(s), null);
  assert.match(supportSettingsProblem({ ...s, enterText: '' })!, /enterText/);
  assert.match(supportSettingsProblem({ ...s, repeatMin: 61 })!, /repeatMin/);
  assert.match(supportSettingsProblem({ ...s, remindAfterMin: 0 })!, /remindAfterMin/);
  assert.equal(supportSettingsProblem({ ...s, estimateText: '' }), null);
});

test('estimate: median in minutes, only from 10 cases', () => {
  assert.equal(supportEstimateMin(Array(9).fill(60_000)), null);
  assert.equal(supportEstimateMin([...Array(9).fill(120_000), 3_600_000]), 2);
  assert.equal(supportEstimateMin([...Array(5).fill(60_000), ...Array(5).fill(180_000)]), 2);
  assert.equal(supportEstimateMin(Array(10).fill(5_000)), 1);
});

test('statistics: waits over taken cases with a known arrival, each supporter credited, per day', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 10, h)).toISOString();
  const e = (id: number, x: Partial<SupportCaseEntry>): SupportCaseEntry => ({
    id, queueId: 1, clientUid: `u${id}`, cldbid: id, nickname: `n${id}`, arrivedAt: at(10), arrivalUnknown: false, state: 'done', position: null,
    absentSince: null, takenAt: null, takenBy: [], takenVia: null, actedBy: null, roomCid: null, endedAt: at(12), endReason: null, ...x,
  });
  const bob = { uid: 'b', nickname: 'Bob', cldbid: 1 };
  const eve = { uid: 'e', nickname: 'Eve', cldbid: 2 };
  const st = supportStats([
    e(1, { takenAt: at(11), takenBy: [bob] }),
    e(2, { takenAt: at(13), takenBy: [bob, eve] }),
    e(3, { state: 'cancelled' }),
    e(4, { takenAt: at(14), takenBy: [eve], arrivalUnknown: true }),
    e(5, { arrivedAt: new Date(Date.UTC(2026, 10, 9, 10)).toISOString(), takenAt: new Date(Date.UTC(2026, 10, 9, 10, 30)).toISOString(), takenBy: [bob] }),
  ], 7, (ms) => new Date(ms).toISOString().slice(0, 10));
  assert.deepEqual([st.cases, st.taken, st.done, st.cancelled], [5, 4, 4, 1]);
  assert.equal(st.avgWaitMs, Math.round((3_600_000 + 10_800_000 + 1_800_000) / 3));
  assert.equal(st.maxWaitMs, 10_800_000);
  assert.deepEqual(st.perSupporter, [{ uid: 'b', nickname: 'Bob', cases: 3, perDay: 0.4 }, { uid: 'e', nickname: 'Eve', cases: 2, perDay: 0.3 }]);
  assert.deepEqual(st.perDay.map((d) => [d.day, d.cases, d.taken, d.cancelled]), [['2026-11-10', 4, 3, 1], ['2026-11-09', 1, 1, 0]]);
});

test('the per-pass budget: what does not fit waits, nothing is marked as sent for it', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1, queueId: 1, clientUid: `c${i}`, cldbid: i, nickname: `c${i}`, arrivedAt: new Date(T0 + i), arrivalUnknown: false, state: 'waiting',
    absentSince: null, takenAt: null, takenBy: null, takenVia: null, actedBy: null, roomCid: null, endedAt: null, endReason: null, notices: null,
  }));
  const clients = [...rows.map((r, i) => cl(r.clientUid, 100 + i, WAIT)), sup('s1', 20)];
  const sent: string[] = [];
  const marked: number[] = [];
  const client = { execute: async (_sid: number, cmd: string, p: any) => { sent.push(`${cmd}:${p.target ?? p.clid}`); return []; } } as any;
  const prisma = {
    supportCase: {
      findMany: async () => [],
      updateMany: async ({ where }: any) => { marked.push(where.id); return { count: 1 }; },
    },
  } as any;
  const budget = { left: NOTICES_PER_PASS };
  await processQueueNotices(prisma, client, { id: 1, sid: 1, channelId: WAIT }, s, rows as any, clients, [sup('s1', 20)], budget, T0);
  // each case costs 2 (message + one poke): 5 cases fit into 10, the sixth waits
  assert.equal(sent.length, 10);
  assert.deepEqual(marked, [1, 2, 3, 4, 5]);
  assert.equal(budget.left, 0);
});
