import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERVIEW_TIER_RANK, resolvePermissionOverview } from '@ts6/common';

// Rules from doc/server/permissiondoc.txt; the Permissions page and the R11 helper both use this.

const row = (rank: number, permvalue: number, extra: { n?: 1; s?: 1; perm?: string; tag?: string } = {}) => ({
  rank, permvalue, permsid: extra.perm ?? 'i_client_kick_from_server_power',
  permnegated: extra.n ?? 0, permskip: extra.s ?? 0, tag: extra.tag ?? `t${rank}v${permvalue}`,
});
const winnerOf = (rows: ReturnType<typeof row>[]) => {
  const res = resolvePermissionOverview(rows);
  assert.equal(res.length, 1);
  return res[0];
};

test('permoverview t 0-4 maps to tiers 1-5', () => {
  assert.deepEqual(OVERVIEW_TIER_RANK, { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 });
});

test('each tier overwrites the one below, whatever the values', () => {
  const tiers = [row(1, 100), row(2, 90), row(3, 80), row(4, 70), row(5, 60)];
  for (let top = 1; top <= 5; top++) {
    assert.equal(winnerOf(tiers.slice(0, top)).winner.rank, top);
  }
});

test('a channel group (4) beats a client permission (2)', () => {
  assert.equal(winnerOf([row(2, 100), row(4, 10)]).winner.permvalue, 10);
});

test('within one tier the highest value wins (several server groups)', () => {
  // the doc example: Server Admin 50, Clan Leader 100, War Organizer unset -> 100
  assert.equal(winnerOf([row(1, 50), row(1, 100)]).winner.permvalue, 100);
});

test('negated entries take over and the lowest negated one wins', () => {
  assert.equal(winnerOf([row(1, 75), row(1, -1, { n: 1 })]).winner.permvalue, -1);
  assert.equal(winnerOf([row(1, 75), row(1, 20, { n: 1 }), row(1, 30, { n: 1 })]).winner.permvalue, 20);
  // a negated value higher than the plain one still wins the tier
  assert.equal(winnerOf([row(1, 10), row(1, 60, { n: 1 })]).winner.permvalue, 60);
});

test('skip on tier 1 or 2 shields from tiers 3 and 4, not from 5', () => {
  for (const shieldTier of [1, 2]) {
    const r = winnerOf([row(shieldTier, 50, { s: 1 }), row(3, 0), row(4, 0)]);
    assert.equal(r.shielded, true);
    assert.equal(r.winner.rank, shieldTier);
    assert.equal(winnerOf([row(shieldTier, 50, { s: 1 }), row(4, 0), row(5, 5)]).winner.rank, 5);
  }
});

test('skip on tier 1 is moot when tier 2 is set; skip only counts on the tier winner', () => {
  // tier 1 shielded, tier 2 overwrites it anyway (2 is not in the shielded set)
  assert.equal(winnerOf([row(1, 50, { s: 1 }), row(2, 5), row(4, 99)]).winner.rank, 2);
  // the skipped entry lost its tier to a higher value -> no shield
  const r = winnerOf([row(1, 10, { s: 1 }), row(1, 50), row(4, 0)]);
  assert.equal(r.shielded, false);
  assert.equal(r.winner.rank, 4);
});

test('skip on tier 3 or 4 shields nothing', () => {
  assert.equal(winnerOf([row(3, 50, { s: 1 }), row(4, 1)]).winner.rank, 4);
});

test('several permissions are resolved apart, sorted by name, all sources kept', () => {
  const res = resolvePermissionOverview([
    row(1, 1, { perm: 'i_client_poke_power' }), row(1, 2, { perm: 'b_a' }), row(2, 3, { perm: 'i_client_poke_power' }),
  ]);
  assert.deepEqual(res.map((r) => r.permsid), ['b_a', 'i_client_poke_power']);
  assert.equal(res[1].sources.length, 2);
  assert.equal(res[1].winner.permvalue, 3);
});

test('ties within a tier keep the first row', () => {
  assert.equal(winnerOf([row(1, 50, { tag: 'a' }), row(1, 50, { tag: 'b' })]).winner.tag, 'a');
});

test('empty input resolves to nothing', () => {
  assert.deepEqual(resolvePermissionOverview([]), []);
});
