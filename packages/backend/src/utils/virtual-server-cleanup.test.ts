import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUpDeletedVirtualServer } from './virtual-server-cleanup.js';

// In-memory tables with just the where-shapes the clean-up uses: equality, { in }, { notIn } and one
// nested relation (UserVirtualServerAccess.access.serverConfigId).
type Row = Record<string, any>;
const matches = (row: Row, where: Row, db: Record<string, Row[]>): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'access') return matches(db.userServerAccess.find((a) => a.id === row.accessId)!, v, db);
  if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
  return row[k] === v;
});
function fakePrisma(db: Record<string, Row[]>) {
  const table = (name: string) => ({
    findMany: async ({ where, select }: any) => db[name].filter((r) => matches(r, where, db))
      .map((r) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r })),
    deleteMany: async ({ where }: any) => {
      const before = db[name].length;
      db[name] = db[name].filter((r) => !matches(r, where, db));
      return { count: before - db[name].length };
    },
    updateMany: async ({ where, data }: any) => {
      const hit = db[name].filter((r) => matches(r, where, db));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  });
  const p: any = { $transaction: (ops: Promise<unknown>[]) => Promise.all(ops) };
  for (const name of Object.keys(db)) p[name] = table(name);
  return p;
}

test('clean-up touches only the deleted virtual server of that connection', async () => {
  // Deleted: connection 1, sid 2. Neighbours: sid 1 on connection 1, sid 2 on connection 3.
  const on = (cfg: number, sid: number, extra: Row = {}) => ({ serverConfigId: cfg, sid, ...extra });
  const db: Record<string, Row[]> = {
    userServerAccess: [{ id: 10, serverConfigId: 1 }, { id: 11, serverConfigId: 3 }],
    userVirtualServerAccess: [{ accessId: 10, sid: 2 }, { accessId: 10, sid: 1 }, { accessId: 11, sid: 2 }],
    protectedServerGroup: [on(1, 2, { sgid: 6 }), on(1, 1, { sgid: 6 }), on(3, 2, { sgid: 6 })],
    temporaryServerGroup: [on(1, 2, { id: 1, state: 'active' }), on(1, 2, { id: 2, state: 'revoked' }), on(1, 1, { id: 3, state: 'active' }), on(3, 2, { id: 4, state: 'waiting' })],
    temporaryGroupNoticeSettings: [on(1, 2), on(3, 2)],
    supportQueue: [on(1, 2, { id: 1, enabled: true }), on(1, 1, { id: 2, enabled: true }), on(3, 2, { id: 3, enabled: true })],
    raidProtection: [on(1, 2), on(1, 1)],
    botFlow: [
      { id: 1, name: 'a', serverConfigId: 1, virtualServerId: 2, enabled: true },
      { id: 2, name: 'b', serverConfigId: 1, virtualServerId: 2, enabled: false },
      { id: 3, name: 'c', serverConfigId: 1, virtualServerId: 1, enabled: true },
      { id: 4, name: 'd', serverConfigId: 3, virtualServerId: 2, enabled: true },
    ],
    widget: [{ id: 1, name: 'w', serverConfigId: 1, virtualServerId: 2 }, { id: 2, name: 'x', serverConfigId: 1, virtualServerId: 1 }],
  };
  const disabled: number[] = [];
  const reloaded: string[] = [];
  const now = new Date('2026-11-14T12:00:00Z');
  const result = await cleanUpDeletedVirtualServer({
    prisma: fakePrisma(db),
    botEngine: { disableFlow: async (id: number) => { disabled.push(id); } },
    raid: { reload: async (c: number, s: number) => { reloaded.push(`${c}:${s}`); } },
  }, 1, 2, now);

  assert.deepEqual(result, {
    accessGrants: 1, protectedGroups: 1, temporaryGroups: 1, supportQueues: 1, raidProtection: true,
    flowsDisabled: [{ id: 1, name: 'a' }], widgets: [{ id: 1, name: 'w' }],
  });
  assert.deepEqual(db.userVirtualServerAccess, [{ accessId: 10, sid: 1 }, { accessId: 11, sid: 2 }]);
  assert.deepEqual(db.protectedServerGroup.map((r) => `${r.serverConfigId}:${r.sid}`), ['1:1', '3:2']);
  assert.deepEqual(db.temporaryServerGroup.map((r) => r.state), ['already-removed', 'revoked', 'active', 'waiting']);
  assert.equal(db.temporaryServerGroup[0].endedAt, now);
  assert.equal(db.temporaryServerGroup[1].endedAt, undefined, 'an ended row keeps its own end');
  assert.deepEqual(db.temporaryGroupNoticeSettings.map((r) => r.serverConfigId), [3]);
  assert.deepEqual(db.supportQueue.map((r) => r.enabled), [false, true, true]);
  assert.deepEqual(db.raidProtection.map((r) => r.sid), [1]);
  assert.deepEqual(db.botFlow.map((r) => r.enabled), [false, false, true, true]);
  assert.deepEqual(disabled, [1]);
  assert.deepEqual(reloaded, ['1:2']);
  assert.equal(db.widget.length, 2, 'widgets are left as they are');
});
