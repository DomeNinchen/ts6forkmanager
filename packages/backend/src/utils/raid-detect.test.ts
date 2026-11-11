import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAID_DEFAULTS, RAID_PRESET_RULES, RAID_INCIDENT_CLIENTS_MAX, raidActionFor, raidPresetOf, raidSettingsProblem, type RaidRules } from '@ts6/common';
import { actionBudget, describeHits, detect, isExempt, longestWindowMs, mergeIncident, nameKey, parseGroupList, pauseEnd, subnetKey, type RaidJoin } from './raid-detect.js';

const T0 = 1_800_000_000_000;
let row = 1;
function join(at: number, extra: Partial<RaidJoin> = {}): RaidJoin {
  const n = row++;
  return {
    rowId: n, at, clid: n, uid: `uid${n}`, cldbid: n, nickname: `Player ${String.fromCharCode(97 + (n % 26))}${String.fromCharCode(97 + ((n / 26) | 0) % 26)}x`,
    ip: `10.${n}.0.1`, country: 'DE', isNew: false, exempt: false, createdAt: null, ...extra,
  };
}
/** Only the total rule, N in S seconds. */
function totalOnly(count: number, windowSec: number): RaidRules {
  const off = { enabled: false, count: 2, windowSec: 60 };
  return { total: { enabled: true, count, windowSec }, subnet: off, country: off, name: off, new: { ...off, sharePct: 50 } };
}
/** Feeds joins one by one like the detector does and returns the rules that fired, per join. */
function run(joins: RaidJoin[], rules: RaidRules, countFrom = 0) {
  const seen: RaidJoin[] = [];
  return joins.map((j) => {
    seen.push(j);
    return detect(seen, j, rules, countFrom);
  });
}

test('total: exactly the threshold within the window fires, one less does not', () => {
  const rules = totalOnly(5, 10);
  const five = Array.from({ length: 5 }, (_, i) => join(T0 + i * 2500)); // 0..10 s, ends included
  assert.equal(run(five, rules).at(-1)!.length, 1);
  const four = Array.from({ length: 4 }, (_, i) => join(T0 + i * 1000));
  assert.ok(run(four, rules).every((h) => h.length === 0));
});

test('total: one ms beyond the window does not count', () => {
  const rules = totalOnly(5, 10);
  const joins = [join(T0), ...Array.from({ length: 4 }, (_, i) => join(T0 + 10_001 + i))];
  assert.ok(run(joins, rules).every((h) => h.length === 0));
});

test('evenly spread joins never fire (12 over 3 minutes against the medium preset)', () => {
  // First to last = 180 s, so any 60 s window holds 4 of them.
  const joins = Array.from({ length: 12 }, (_, i) => join(T0 + Math.round((i * 180_000) / 11), { ip: '172.17.0.1', isNew: true, nickname: `raider${i}` }));
  assert.ok(run(joins, RAID_PRESET_RULES.medium).every((h) => h.length === 0));
});

test('12 joins in 10 seconds fire on the medium preset (network, name, new identities)', () => {
  const joins = Array.from({ length: 12 }, (_, i) => join(T0 + i * 900, { ip: '172.17.0.1', isNew: true, nickname: `raider${i}` }));
  const last = run(joins, RAID_PRESET_RULES.medium).at(-1)!;
  assert.deepEqual(last.map((h) => h.rule).sort(), ['name', 'new', 'subnet']);
  assert.equal(last.find((h) => h.rule === 'subnet')!.key, '172.17.0.0/24');
  assert.equal(last.find((h) => h.rule === 'name')!.key, 'raider');
  assert.equal(last.find((h) => h.rule === 'new')!.count, 12);
});

test('a short burst below the threshold does not fire', () => {
  const joins = [join(T0), join(T0 + 100), join(T0 + 200), join(T0 + 60_000)];
  assert.ok(run(joins, totalOnly(4, 5)).every((h) => h.length === 0));
});

test('subnet: groups by /24 and /64, other networks do not count', () => {
  assert.equal(subnetKey('203.0.113.77'), '203.0.113.0/24');
  assert.equal(subnetKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(subnetKey('2001:db8:1:2::'), '2001:db8:1:2::/64');
  assert.equal(subnetKey('::ffff:198.51.100.9'), '198.51.100.0/24');
  assert.equal(subnetKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(subnetKey('unknown'), null);
  assert.equal(subnetKey(null), null);
  const off = { enabled: false, count: 2, windowSec: 60 };
  const rules: RaidRules = { total: off, subnet: { enabled: true, count: 3, windowSec: 60 }, country: off, name: off, new: { ...off, sharePct: 50 } };
  const mixed = [join(T0, { ip: '203.0.113.1' }), join(T0 + 1, { ip: '198.51.100.1' }), join(T0 + 2, { ip: '203.0.113.200' }), join(T0 + 3, { ip: '2001:db8::1' })];
  assert.ok(run(mixed, rules).every((h) => h.length === 0));
  const third = run([...mixed, join(T0 + 4, { ip: '203.0.113.9' })], rules).at(-1)!;
  assert.equal(third[0].key, '203.0.113.0/24');
  assert.equal(third[0].count, 3);
});

test('country: counts per country, joins without a country never count', () => {
  const off = { enabled: false, count: 2, windowSec: 60 };
  const rules: RaidRules = { total: off, subnet: off, country: { enabled: true, count: 3, windowSec: 60 }, name: off, new: { ...off, sharePct: 50 } };
  const joins = [join(T0, { country: 'BR' }), join(T0 + 1, { country: '' }), join(T0 + 2, { country: null }), join(T0 + 3, { country: 'BR' }), join(T0 + 4, { country: 'DE' })];
  assert.ok(run(joins, rules).every((h) => h.length === 0));
  const hit = run([...joins, join(T0 + 5, { country: 'BR' })], rules).at(-1)!;
  assert.equal(hit[0].key, 'BR');
});

test('name: similar names share a stem; too short stems never count', () => {
  assert.equal(nameKey('Raider12'), 'raider');
  assert.equal(nameKey('raider_7'), 'raider');
  assert.equal(nameKey('RÄIDER-99'), 'raider');
  assert.equal(nameKey('xx1'), null);
  assert.equal(nameKey('1234'), null);
  const off = { enabled: false, count: 2, windowSec: 60 };
  const rules: RaidRules = { total: off, subnet: off, country: off, name: { enabled: true, count: 3, windowSec: 60 }, new: { ...off, sharePct: 50 } };
  const joins = [join(T0, { nickname: 'Bot1' }), join(T0 + 1, { nickname: 'bot-2' }), join(T0 + 2, { nickname: 'Alice' }), join(T0 + 3, { nickname: 'BOT_3' })];
  const hits = run(joins, rules);
  assert.equal(hits[2].length, 0);
  assert.equal(hits[3][0].key, 'bot');
  assert.deepEqual(hits[3][0].joins.map((j) => j.nickname), ['Bot1', 'bot-2', 'BOT_3']);
});

test('new identities: needs the count and the share', () => {
  const off = { enabled: false, count: 2, windowSec: 60 };
  const rules: RaidRules = { total: off, subnet: off, country: off, name: off, new: { enabled: true, count: 3, windowSec: 60, sharePct: 60 } };
  // 3 new of 6 = 50 % < 60 %
  const half = [join(T0), join(T0 + 1, { isNew: true }), join(T0 + 2), join(T0 + 3, { isNew: true }), join(T0 + 4), join(T0 + 5, { isNew: true })];
  assert.ok(run(half, rules).every((h) => h.length === 0));
  // 3 new of 4 = 75 %
  const most = [join(T0), join(T0 + 1, { isNew: true }), join(T0 + 2, { isNew: true }), join(T0 + 3, { isNew: true })];
  const last = run(most, rules).at(-1)!;
  assert.equal(last[0].rule, 'new');
  assert.equal(last[0].joins.length, 3);
});

test('exempt joins never count and never fire', () => {
  const rules = totalOnly(3, 60);
  const joins = [join(T0, { exempt: true }), join(T0 + 1, { exempt: true }), join(T0 + 2), join(T0 + 3, { exempt: true })];
  assert.ok(run(joins, rules).every((h) => h.length === 0));
  const withThird = run([...joins, join(T0 + 4), join(T0 + 5)], rules).at(-1)!;
  assert.equal(withThird[0].count, 3);
  assert.ok(withThird[0].joins.every((j) => !j.exempt));
});

test('pause: nothing before countFrom counts, nothing fires before it', () => {
  const rules = totalOnly(3, 600);
  // A restart wave at T0, the pause ends at T0 + 5 min: two joins after it do not reach 3.
  const wave = Array.from({ length: 10 }, (_, i) => join(T0 + i * 100));
  const after = [join(T0 + 300_000), join(T0 + 300_500)];
  const countFrom = T0 + 300_000;
  assert.ok(run([...wave, ...after], rules, countFrom).every((h) => h.length === 0));
  // Positive control: without the pause the same joins fire.
  assert.ok(run([...wave, ...after], rules, 0).some((h) => h.length > 0));
});

test('pauseEnd: grace after server start and after watching again, the later one wins', () => {
  assert.equal(pauseEnd(5, null, null), null);
  assert.deepEqual(pauseEnd(5, T0 - 60_000, null), { until: T0 + 240_000, reason: 'server-start' });
  assert.deepEqual(pauseEnd(5, T0 - 60_000, T0 - 10_000), { until: T0 + 290_000, reason: 'watching-again' });
  assert.deepEqual(pauseEnd(5, T0, T0 - 600_000), { until: T0 + 300_000, reason: 'server-start' });
  assert.deepEqual(pauseEnd(0, T0, null), { until: T0, reason: 'server-start' });
});

test('isExempt: query clients, own bots, exempt groups, known members', () => {
  const ctx = { ownBotUids: new Set(['BOT']), exemptGroups: new Set([6, 50]), knownSessions: 3 };
  const base = { type: 0, uid: 'X', groups: [8], earlierSessions: 0 };
  assert.equal(isExempt(base, ctx), false);
  assert.equal(isExempt({ ...base, type: 1 }, ctx), true);
  assert.equal(isExempt({ ...base, uid: 'BOT' }, ctx), true);
  assert.equal(isExempt({ ...base, groups: [8, 50] }, ctx), true);
  assert.equal(isExempt({ ...base, earlierSessions: 2 }, ctx), false);
  assert.equal(isExempt({ ...base, earlierSessions: 3 }, ctx), true);
  assert.equal(isExempt({ ...base, earlierSessions: 99 }, { ...ctx, knownSessions: 0 }), false);
  assert.deepEqual(parseGroupList('8,50,,x,0'), [8, 50]);
  assert.deepEqual(parseGroupList(null), []);
});

test('longestWindowMs: at least a minute, the longest enabled rule otherwise', () => {
  assert.equal(longestWindowMs(totalOnly(3, 10)), 60_000);
  assert.equal(longestWindowMs(totalOnly(3, 300)), 300_000);
});

test('mergeIncident: one hit per rule and key, one client per join, a cap on kept clients', () => {
  const a = join(T0, { uid: 'A' });
  const b = join(T0 + 1, { uid: 'B' });
  const first = mergeIncident({ hits: [], clients: [], clientCount: 0 }, [{ rule: 'total', key: null, count: 2, windowSec: 60, joins: [a, b] }], T0 + 1);
  assert.equal(first.clientCount, 2);
  const c = join(T0 + 2, { uid: 'C' });
  const second = mergeIncident(first, [
    { rule: 'total', key: null, count: 3, windowSec: 60, joins: [a, b, c] },
    { rule: 'subnet', key: '10.0.0.0/24', count: 2, windowSec: 60, joins: [b, c] },
  ], T0 + 2);
  assert.equal(second.clientCount, 3);
  assert.deepEqual(second.hits.map((h) => [h.rule, h.count]), [['total', 3], ['subnet', 2]]);
  assert.equal(second.hits[0].at, new Date(T0 + 1).toISOString()); // first time it fired stays

  const many = Array.from({ length: RAID_INCIDENT_CLIENTS_MAX + 5 }, (_, i) => join(T0 + i, { uid: `M${i}` }));
  const big = mergeIncident({ hits: [], clients: [], clientCount: 0 }, [{ rule: 'total', key: null, count: many.length, windowSec: 60, joins: many }], T0);
  assert.equal(big.clients.length, RAID_INCIDENT_CLIENTS_MAX);
  assert.equal(big.clientCount, RAID_INCIDENT_CLIENTS_MAX + 5);
});

test('ladder: highest level of the rules that caught a client, queued only while acting', () => {
  const actions = { total: 'warn', subnet: 'kick', country: 'none', name: 'restrict', new: 'ban' } as const;
  assert.equal(raidActionFor(['total', 'name'], actions), 'restrict');
  assert.equal(raidActionFor(['country'], actions), 'none');
  assert.equal(raidActionFor([], actions), 'none');
  const a = join(T0, { uid: 'A' });
  const b = join(T0 + 1, { uid: 'B' });
  const hits = [
    { rule: 'total' as const, key: null, count: 2, windowSec: 60, joins: [a, b] },
    { rule: 'subnet' as const, key: '10.0.0.0/24', count: 1, windowSec: 60, joins: [b] },
  ];
  const observing = mergeIncident({ hits: [], clients: [], clientCount: 0 }, hits, T0, { actions, acting: false });
  assert.deepEqual(observing.clients.map((c) => [c.uid, c.action, c.outcome?.state]), [['A', 'warn', undefined], ['B', 'kick', undefined]]);
  const acting = mergeIncident({ hits: [], clients: [], clientCount: 0 }, hits, T0, { actions, acting: true });
  assert.deepEqual(acting.clients.map((c) => [c.uid, c.action, c.outcome?.state]), [['A', 'warn', 'pending'], ['B', 'kick', 'pending']]);
  // A caught later by a higher rule: goes up while still pending...
  const later = [{ rule: 'new' as const, key: null, count: 1, windowSec: 60, joins: [a] }];
  assert.equal(mergeIncident(acting, later, T0 + 5, { actions, acting: true }).clients[0].action, 'ban');
  // ...but never once something was done to it.
  const done = { ...acting, clients: acting.clients.map((c) => (c.uid === 'A' ? { ...c, outcome: { state: 'done' as const, at: '', note: null } } : c)) };
  const after = mergeIncident(done, later, T0 + 5, { actions, acting: true }).clients[0];
  assert.deepEqual([after.action, after.outcome?.state], ['warn', 'done']);
  // 'none' is never queued.
  const none = mergeIncident({ hits: [], clients: [], clientCount: 0 }, [{ rule: 'country', key: 'BR', count: 1, windowSec: 60, joins: [join(T0, { uid: 'C' })] }], T0, { actions, acting: true });
  assert.deepEqual([none.clients[0].action, none.clients[0].outcome], ['none', undefined]);
});

test('actionBudget: at most N actions within any minute', () => {
  assert.equal(actionBudget([], T0, 3), 3);
  assert.equal(actionBudget([T0 - 1000, T0 - 2000], T0, 3), 1);
  assert.equal(actionBudget([T0 - 1000, T0 - 2000, T0 - 3000, T0 - 4000], T0, 3), 0);
  assert.equal(actionBudget([T0 - 60_000, T0 - 61_000], T0, 3), 3);
});

test('settings: action rules', () => {
  const withAction = (patch: Partial<typeof RAID_DEFAULTS>) => raidSettingsProblem({ ...RAID_DEFAULTS, ...patch });
  assert.match(withAction({ actions: { ...RAID_DEFAULTS.actions, subnet: 'restrict' } })!, /restrict needs a server group/);
  assert.equal(withAction({ actions: { ...RAID_DEFAULTS.actions, subnet: 'restrict' }, restrictGroupId: 9 }), null);
  // A restrict on a rule that is off needs no group.
  assert.equal(withAction({ actions: { ...RAID_DEFAULTS.actions, country: 'restrict' } }), null);
  assert.match(withAction({ banMinutes: 61 })!, /banMinutes/);
  assert.match(withAction({ banMinutes: 9 })!, /banMinutes/);
  assert.match(withAction({ kickReason: 'x'.repeat(41) })!, /kickReason/);
  assert.match(withAction({ actions: { ...RAID_DEFAULTS.actions, total: 'nuke' as any } })!, /actions/);
  assert.match(withAction({ actions: { ...RAID_DEFAULTS.actions, total: 'warn' }, warnText: ' ' })!, /warnText/);
  assert.match(withAction({ maxActionsPerMin: 0 })!, /maxActionsPerMin/);
});

test('describeHits words each rule', () => {
  const at = new Date(T0).toISOString();
  assert.equal(
    describeHits([{ rule: 'total', key: null, count: 12, windowSec: 60, at }, { rule: 'subnet', key: '1.2.3.0/24', count: 12, windowSec: 60, at }, { rule: 'new', key: null, count: 9, windowSec: 60, at }]),
    '12 joins in 60 s, 12 from 1.2.3.0/24, 9 new identities',
  );
});

test('settings: defaults are valid, broken values are named, presets are recognised', () => {
  assert.equal(raidSettingsProblem(RAID_DEFAULTS), null);
  assert.match(raidSettingsProblem({ ...RAID_DEFAULTS, rules: { ...RAID_DEFAULTS.rules, total: { enabled: true, count: 1, windowSec: 60 } } })!, /rule total: count/);
  assert.match(raidSettingsProblem({ ...RAID_DEFAULTS, rules: { ...RAID_DEFAULTS.rules, name: { enabled: true, count: 3, windowSec: 4 } } })!, /rule name: window/);
  assert.match(raidSettingsProblem({ ...RAID_DEFAULTS, exemptGroupIds: [0] })!, /exemptGroupIds/);
  assert.match(raidSettingsProblem({ ...RAID_DEFAULTS, notify: 'poke', notifyText: ' ' })!, /notifyText is empty/);
  assert.match(raidSettingsProblem({ ...RAID_DEFAULTS, graceMin: 500 })!, /graceMin/);
  assert.equal(raidPresetOf(RAID_PRESET_RULES.strict), 'strict');
  assert.equal(raidPresetOf(JSON.parse(JSON.stringify(RAID_PRESET_RULES.lax))), 'lax');
  assert.equal(raidPresetOf(totalOnly(3, 60)), null);
});
