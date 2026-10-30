import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantCovers, mayUseMusicBot } from './vs-access.js';

// Stand-ins for the database and TeamSpeak; the real narrowing and checks run in the PR's live test.
const grantRow = (all: boolean, sids: number[]) => ({ allVirtualServers: all, virtualServers: sids.map((sid) => ({ sid })) });
const prismaWith = (row: unknown) => ({ userServerAccess: { findUnique: async () => row } }) as any;
let lookups = 0;
const pool = (configId: number) => ({
  tryGetClient: (id: number) => (id === configId ? {
    execute: async () => { lookups++; return [{ virtualserver_id: '1', virtualserver_port: '9987' }, { virtualserver_id: '2', virtualserver_port: '9988' }]; },
  } : null),
}) as any;

test('a grant covers the virtual servers it names, or every one while it covers all', () => {
  assert.equal(grantCovers({ all: false, sids: new Set([2]) }, 2), true);
  assert.equal(grantCovers({ all: false, sids: new Set([2]) }, 1), false);
  assert.equal(grantCovers({ all: true, sids: new Set() }, 7), true);
  assert.equal(grantCovers(null, 1), false);
});

test('a music bot belongs to the virtual server of its voice port', async () => {
  const p = pool(10);
  assert.equal(await mayUseMusicBot(prismaWith(grantRow(false, [2])), p, 1, { serverConfigId: 10, voicePort: 9988 }), true);
  assert.equal(await mayUseMusicBot(prismaWith(grantRow(false, [2])), p, 1, { serverConfigId: 10, voicePort: 9987 }), false);
  // A port no virtual server uses belongs to none.
  assert.equal(await mayUseMusicBot(prismaWith(grantRow(false, [1, 2])), p, 1, { serverConfigId: 10, voicePort: 1234 }), false);
});

test('the voice port lookup is cached per connection', async () => {
  const p = pool(11);
  lookups = 0;
  for (let i = 0; i < 3; i++) await mayUseMusicBot(prismaWith(grantRow(false, [1])), p, 1, { serverConfigId: 11, voicePort: 9987 });
  assert.equal(lookups, 1);
});

test('no grant means no bot; a grant covering all needs no lookup', async () => {
  assert.equal(await mayUseMusicBot(prismaWith(null), pool(12), 1, { serverConfigId: 12, voicePort: 9987 }), false);
  lookups = 0;
  assert.equal(await mayUseMusicBot(prismaWith(grantRow(true, [])), pool(12), 1, { serverConfigId: 12, voicePort: 1 }), true);
  assert.equal(lookups, 0);
});

test('without a readable server list a narrowed grant is refused (fails closed)', async () => {
  const noQuery = { tryGetClient: () => null } as any;
  assert.equal(await mayUseMusicBot(prismaWith(grantRow(false, [1])), noQuery, 1, { serverConfigId: 13, voicePort: 9987 }), false);
  const broken = { tryGetClient: () => ({ execute: async () => { throw new Error('down'); } }) } as any;
  assert.equal(await mayUseMusicBot(prismaWith(grantRow(false, [1])), broken, 1, { serverConfigId: 14, voicePort: 9987 }), false);
});
