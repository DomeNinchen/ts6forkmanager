import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWhatIf, WhatIfError, WHATIF_MAX_CHANGES, type WhatIfChange, type WhatIfInput, type WhatIfRow } from '@ts6/common';

// Pure "what if" (R11 stage 4): rows changed in memory, the R11 evaluation run before and after.

const ACTOR = 100, TARGET = 200, DEF = 56, MOD = 60, VIP = 61;
const g = (sgid: number, permsid: string, permvalue: number, permnegated = 0, permskip = 0): WhatIfRow =>
  ({ rank: 1, t: 0, id1: sgid, id2: 0, permsid, permvalue, permnegated, permskip });
const c = (cldbid: number, permsid: string, permvalue: number, permskip = 0): WhatIfRow =>
  ({ rank: 2, t: 1, id1: cldbid, id2: 0, permsid, permvalue, permnegated: 0, permskip });
const ch = (permsid: string, permvalue: number): WhatIfRow => ({ rank: 3, t: 2, id1: 1, id2: 0, permsid, permvalue, permnegated: 0, permskip: 0 });
const gp = (permsid: string, permvalue: number, permnegated = 0, permskip = 0) => ({ permsid, permvalue, permnegated, permskip });

const KICK = 'i_client_kick_from_server_power', NEED = 'i_client_needed_kick_from_server_power';

function input(over: Partial<WhatIfInput> = {}, changes: WhatIfChange[] = []): WhatIfInput {
  const actorRows = [g(DEF, KICK, 10)];
  return {
    base: {
      action: 'kick-server', targetOnline: true, actorOnline: true,
      actorInOwnChannel: actorRows, actorInTargetChannel: actorRows, target: [g(DEF, NEED, 50)],
    },
    changes,
    actor: { cldbid: ACTOR, groups: [DEF] },
    target: { cldbid: TARGET, groups: [DEF] },
    defaultSgid: DEF,
    groupPerms: { [DEF]: [gp(KICK, 10), gp(NEED, 50)], [MOD]: [gp(KICK, 75)], [VIP]: [gp(NEED, 80)] },
    ...over,
  };
}
const run = (changes: WhatIfChange[], over: Partial<WhatIfInput> = {}) => evaluateWhatIf(input(over, changes));

test('adding the actor to a group adds its rows and drops the default group', () => {
  const res = run([{ kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' }]);
  assert.equal(res.before.verdict, 'denied');
  assert.equal(res.after.verdict, 'allowed');
  assert.deepEqual(res.groups.actor, { before: [DEF], after: [MOD] });
  assert.equal(res.after.checks[0].have.value, 75);
  assert.equal(res.after.checks[0].have.source?.id1, MOD);
});

test('removing the last group brings the default group back', () => {
  const res = run([{ kind: 'group-member', who: 'actor', sgid: MOD, op: 'remove' }], {
    actor: { cldbid: ACTOR, groups: [MOD] },
    base: { ...input().base, actorInOwnChannel: [g(MOD, KICK, 75)], actorInTargetChannel: [g(MOD, KICK, 75)] },
  });
  assert.equal(res.before.verdict, 'allowed');
  assert.equal(res.after.verdict, 'denied');
  assert.deepEqual(res.groups.actor.after, [DEF]);
  assert.equal(res.after.checks[0].have.value, 10);
});

test('target joins a group that raises its needed power', () => {
  const res = run([{ kind: 'group-member', who: 'target', sgid: VIP, op: 'add' },
    { kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' }]);
  assert.equal(res.after.verdict, 'denied'); // 75 < 80
  assert.equal(res.after.checks[0].need?.value, 80);
});

test('a group value change hits every member, actor and target alike', () => {
  const both = run([{ kind: 'group-perm', sgid: DEF, permsid: NEED, value: { permvalue: 5 } },
    { kind: 'group-perm', sgid: DEF, permsid: KICK, value: { permvalue: 5 } }]);
  assert.equal(both.after.verdict, 'allowed');
  assert.equal(both.after.checks[0].have.value, 5);
  assert.equal(both.after.checks[0].need?.value, 5);
  // the actor is no longer a member, so the edit only reaches the target
  const onlyTarget = run([{ kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' },
    { kind: 'group-perm', sgid: DEF, permsid: KICK, value: { permvalue: 0 } }]);
  assert.equal(onlyTarget.after.checks[0].have.value, 75);
});

test('a group value can be inserted, changed and removed', () => {
  const ins = run([{ kind: 'group-perm', sgid: DEF, permsid: 'i_client_poke_power', value: { permvalue: 1 } }]);
  assert.ok(ins.after.checks); // nothing to do with kick: verdict unchanged
  assert.equal(ins.after.verdict, ins.before.verdict);
  const del = run([{ kind: 'group-perm', sgid: DEF, permsid: NEED, value: null }]);
  assert.equal(del.after.checks[0].need?.value, 0);
  assert.equal(del.after.verdict, 'allowed'); // 10 >= 0
});

test('a client value beats its groups (tier 2), and can be removed', () => {
  const set = run([{ kind: 'client-perm', who: 'actor', permsid: KICK, value: { permvalue: 60 } }]);
  assert.equal(set.after.verdict, 'allowed');
  assert.equal(set.after.checks[0].have.source?.rank, 2);
  assert.equal(set.after.checks[0].have.source?.id1, ACTOR);
  const base = input().base;
  const del = run([{ kind: 'client-perm', who: 'actor', permsid: KICK, value: null }], {
    base: { ...base, actorInOwnChannel: [...base.actorInOwnChannel, c(ACTOR, KICK, 60)], actorInTargetChannel: [...base.actorInTargetChannel!, c(ACTOR, KICK, 60)] },
  });
  assert.equal(del.before.verdict, 'allowed');
  assert.equal(del.after.verdict, 'denied');
});

test('negated and skip flags of an added group are carried over', () => {
  const groupPerms = { ...input().groupPerms, [MOD]: [gp(KICK, 75)], [VIP]: [gp(KICK, 3, 1)] };
  const neg = run([{ kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' }, { kind: 'group-member', who: 'actor', sgid: VIP, op: 'add' }], { groupPerms });
  assert.equal(neg.after.checks[0].have.value, 3); // the negated row wins inside tier 1
  // skip on tier 1 shields it from a channel value
  const base = input().base;
  const withChannel = { ...base, actorInTargetChannel: [...base.actorInTargetChannel!, ch(KICK, 99)] };
  const plain = run([], { base: withChannel });
  assert.equal(plain.after.checks[0].have.value, 99);
  const skip = run([{ kind: 'group-perm', sgid: DEF, permsid: KICK, value: { permvalue: 10, permskip: true } }], { base: withChannel });
  assert.equal(skip.after.checks[0].have.value, 10);
});

test('group actions: membership and the group\'s own needed value follow the changes', () => {
  const base = { ...input().base, action: 'group-add' as const,
    actorInOwnChannel: [g(DEF, 'i_group_member_add_power', 50)],
    group: { sgid: VIP, perms: [{ permsid: 'i_group_needed_member_add_power', permvalue: 60 }], targetIsMember: false } };
  const res = run([{ kind: 'group-perm', sgid: VIP, permsid: 'i_group_needed_member_add_power', value: { permvalue: 40 } }], { base });
  assert.equal(res.before.verdict, 'denied');
  assert.equal(res.after.verdict, 'allowed');
  const member = run([{ kind: 'group-member', who: 'target', sgid: VIP, op: 'add' }], { base });
  assert.equal(member.after.verdict, 'impossible');
  assert.ok(member.after.notes.includes('already-member'));
  // modify power of the actor comes from its (new) groups as well
  const groupPerms = { ...input().groupPerms, [MOD]: [gp('i_client_permission_modify_power', 1), gp('i_group_member_add_power', 70)] };
  const mod = run([{ kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' }],
    { base: { ...base, target: [g(DEF, 'i_client_needed_permission_modify_power', 1)] }, groupPerms });
  assert.equal(mod.before.verdict, 'denied');
  assert.equal(mod.after.verdict, 'allowed');
});

test('order of changes does not matter', () => {
  const list: WhatIfChange[] = [
    { kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' },
    { kind: 'group-member', who: 'target', sgid: VIP, op: 'add' },
    { kind: 'group-perm', sgid: VIP, permsid: NEED, value: { permvalue: 70 } },
    { kind: 'client-perm', who: 'target', permsid: NEED, value: { permvalue: 76 } },
  ];
  const a = run(list), b = run([...list].reverse());
  assert.deepEqual(a.after, b.after);
  assert.equal(a.after.checks[0].need?.value, 76);
  assert.equal(a.after.verdict, 'denied');
});

test('the input is not mutated', () => {
  const inp = input({}, [{ kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' }, { kind: 'client-perm', who: 'target', permsid: NEED, value: null }]);
  const copy = structuredClone(inp);
  evaluateWhatIf(inp);
  assert.deepEqual(inp, copy);
});

test('broken input is refused with a reason and the change index', () => {
  const fails = (changes: WhatIfChange[], problem: string, index: number) =>
    assert.throws(() => run(changes), (e: unknown) => e instanceof WhatIfError && e.problem === problem && e.index === index);
  fails([{ kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' }, { kind: 'group-member', who: 'actor', sgid: MOD, op: 'remove' }], 'conflict', 1);
  fails([{ kind: 'group-perm', sgid: DEF, permsid: KICK, value: null }, { kind: 'group-perm', sgid: DEF, permsid: KICK, value: { permvalue: 1 } }], 'conflict', 1);
  fails([{ kind: 'group-member', who: 'actor', sgid: DEF, op: 'add' }], 'default-group', 0);
  fails([{ kind: 'group-member', who: 'actor', sgid: VIP, op: 'remove' }], 'not-member', 0);
  fails([{ kind: 'group-member', who: 'target', sgid: 999, op: 'add' }], 'invalid-group', 0);
  assert.throws(() => run([{ kind: 'group-member', who: 'actor', sgid: MOD, op: 'add' }], { actor: { cldbid: ACTOR, groups: [MOD] } }),
    (e: unknown) => e instanceof WhatIfError && e.problem === 'already-member');
  const many = Array.from({ length: WHATIF_MAX_CHANGES + 1 }, (_, i): WhatIfChange => ({ kind: 'client-perm', who: 'actor', permsid: `p${i}`, value: null }));
  assert.throws(() => run(many), (e: unknown) => e instanceof WhatIfError && e.problem === 'too-many');
});

test('no changes: before and after are identical', () => {
  const res = run([]);
  assert.deepEqual(res.after, res.before);
});

// ---- channel tiers (stage 4a) ----
// Actor in its own channel OWN, target in channel TCH; the default channel group DCG gives kick 10 there.
const OWN = 5, TCH = 7, OTHER = 9, DCG = 39, CMOD = 70, CVIP = 71;
const cgr = (cid: number, cgid: number, permsid: string, permvalue: number, permskip = 0): WhatIfRow =>
  ({ rank: 4, t: 3, id1: cid, id2: cgid, permsid, permvalue, permnegated: 0, permskip });
const chr = (cid: number, permsid: string, permvalue: number): WhatIfRow => ({ rank: 3, t: 2, id1: cid, id2: 0, permsid, permvalue, permnegated: 0, permskip: 0 });
function chInput(over: Partial<WhatIfInput> = {}): Partial<WhatIfInput> {
  return {
    base: {
      action: 'kick-server', targetOnline: true, actorOnline: true,
      actorInOwnChannel: [g(DEF, KICK, 0), cgr(OWN, DCG, KICK, 10)],
      actorInTargetChannel: [g(DEF, KICK, 0), cgr(TCH, DCG, KICK, 10)],
      // the target's need comes from its server group only (its channel group sets none)
      target: [g(DEF, NEED, 50)],
    },
    channels: {
      cids: { actorInOwnChannel: OWN, actorInTargetChannel: TCH, target: TCH },
      defaultCgid: DCG,
      groups: { actor: {}, target: {} },
      groupPerms: { [DCG]: [gp(KICK, 10)], [CMOD]: [gp(KICK, 80)], [CVIP]: [gp(NEED, 90)] },
    },
    ...over,
  };
}
const runCh = (changes: WhatIfChange[], over: Partial<WhatIfInput> = {}) => evaluateWhatIf(input(chInput(over), changes));

test('channel group assignment: one group per channel, read where the answer reads', () => {
  const res = runCh([{ kind: 'channel-group-member', who: 'actor', cid: TCH, cgid: CMOD }]);
  assert.equal(res.before.verdict, 'denied');
  assert.equal(res.after.verdict, 'allowed');
  assert.equal(res.after.checks[0].have.value, 80);
  assert.deepEqual([res.after.checks[0].have.source?.id1, res.after.checks[0].have.source?.id2], [TCH, CMOD]);
  assert.deepEqual(res.channelGroups, [{ who: 'actor', cid: TCH, before: DCG, after: CMOD }]);
  assert.deepEqual(res.unused, []);
  // the same group in the actor's own channel does not count for a kick (read in the target's channel)
  assert.equal(runCh([{ kind: 'channel-group-member', who: 'actor', cid: OWN, cgid: CMOD }]).after.verdict, 'denied');
  // a channel the answer never reads: no effect, reported as unused
  const other = runCh([{ kind: 'channel-group-member', who: 'actor', cid: OTHER, cgid: CMOD }]);
  assert.deepEqual(other.unused, [0]);
  assert.deepEqual(other.after, other.before);
  // the target gets a group that raises its need in its channel
  const tgt = runCh([{ kind: 'channel-group-member', who: 'actor', cid: TCH, cgid: CMOD }, { kind: 'channel-group-member', who: 'target', cid: TCH, cgid: CVIP }]);
  assert.equal(tgt.after.checks[0].need?.value, 90);
  assert.equal(tgt.after.verdict, 'denied');
});

test('setting the default channel group again brings its rows back', () => {
  const base = { ...chInput().base!, actorInTargetChannel: [g(DEF, KICK, 0), cgr(TCH, CMOD, KICK, 80)] };
  const channels = { ...chInput().channels!, groups: { actor: { [TCH]: CMOD }, target: {} } };
  const res = runCh([{ kind: 'channel-group-member', who: 'actor', cid: TCH, cgid: DCG }], { base, channels });
  assert.equal(res.before.verdict, 'allowed');
  assert.equal(res.after.verdict, 'denied');
  assert.equal(res.after.checks[0].have.source?.id2, DCG);
});

test('channel group refusals: already that group, unknown/template group, two for one channel', () => {
  const fails = (changes: WhatIfChange[], problem: string) =>
    assert.throws(() => runCh(changes), (e: unknown) => e instanceof WhatIfError && e.problem === problem);
  fails([{ kind: 'channel-group-member', who: 'actor', cid: TCH, cgid: DCG }], 'already-member');
  fails([{ kind: 'channel-group-member', who: 'actor', cid: TCH, cgid: 4 }], 'invalid-group');
  fails([{ kind: 'channel-group-member', who: 'actor', cid: TCH, cgid: CMOD }, { kind: 'channel-group-member', who: 'actor', cid: TCH, cgid: CVIP }], 'conflict');
});

test('channel group value: hits whoever has the group in a read channel', () => {
  const res = runCh([{ kind: 'channel-group-perm', cgid: DCG, permsid: KICK, value: { permvalue: 55 } }]);
  assert.equal(res.after.checks[0].have.value, 55);
  assert.equal(res.after.verdict, 'allowed');
  // after switching the actor away from DCG in the target channel the edit no longer reaches it there
  const moved = runCh([{ kind: 'channel-group-member', who: 'actor', cid: TCH, cgid: CVIP },
    { kind: 'channel-group-perm', cgid: DCG, permsid: KICK, value: { permvalue: 55 } }]);
  assert.equal(moved.after.checks[0].have.value, 0); // CVIP sets no kick power, tier 1 says 0
  // a group nobody has in a read channel
  assert.deepEqual(runCh([{ kind: 'channel-group-perm', cgid: CMOD, permsid: KICK, value: { permvalue: 1 } }]).unused, [0]);
});

test('channel and channel-client values', () => {
  // a channel value in the target channel counts for actor and target alike
  const chan = runCh([{ kind: 'channel-perm', cid: TCH, permsid: NEED, value: { permvalue: 5 } }]);
  assert.equal(chan.after.checks[0].need?.value, 5);
  assert.equal(chan.after.verdict, 'allowed');
  assert.deepEqual(runCh([{ kind: 'channel-perm', cid: OTHER, permsid: NEED, value: { permvalue: 5 } }]).unused, [0]);
  // a channel-client value (tier 5) beats the channel group
  const cc = runCh([{ kind: 'channel-client-perm', who: 'actor', cid: TCH, permsid: KICK, value: { permvalue: 60 } }]);
  assert.equal(cc.after.checks[0].have.value, 60);
  assert.equal(cc.after.checks[0].have.source?.rank, 5);
  assert.deepEqual([cc.after.checks[0].have.source?.id1, cc.after.checks[0].have.source?.id2], [TCH, ACTOR]);
  // removing a channel value that exists
  const withCh = { ...chInput().base!, target: [g(DEF, NEED, 50), chr(TCH, NEED, 5)] };
  const del = runCh([{ kind: 'channel-perm', cid: TCH, permsid: NEED, value: null }], { base: withCh });
  assert.equal(del.before.checks[0].need?.value, 5);
  assert.equal(del.after.checks[0].need?.value, 50);
});

test('a skip flag on a server group value shields it from planned channel values, not from tier 5', () => {
  const base = { ...chInput().base!, actorInTargetChannel: [g(DEF, KICK, 20, 0, 1), cgr(TCH, DCG, KICK, 10)] };
  const res = runCh([{ kind: 'channel-group-perm', cgid: DCG, permsid: KICK, value: { permvalue: 99 } },
    { kind: 'channel-perm', cid: TCH, permsid: KICK, value: { permvalue: 98 } }], { base });
  assert.equal(res.after.checks[0].have.value, 20);
  const t5 = runCh([{ kind: 'channel-client-perm', who: 'actor', cid: TCH, permsid: KICK, value: { permvalue: 97 } }], { base });
  assert.equal(t5.after.checks[0].have.value, 97);
});

test('group actions: the target\'s needed modify power ignores channel values', () => {
  const base = { ...chInput().base!, action: 'group-add' as const,
    actorInOwnChannel: [g(DEF, 'i_group_member_add_power', 100), g(DEF, 'i_client_permission_modify_power', 10)],
    target: [g(DEF, 'i_client_needed_permission_modify_power', 5)],
    group: { sgid: VIP, perms: [], targetIsMember: false } };
  const res = runCh([{ kind: 'channel-client-perm', who: 'target', cid: TCH, permsid: 'i_client_needed_permission_modify_power', value: { permvalue: 50 } }], { base });
  assert.equal(res.after.verdict, 'allowed');
  // the actor's own channel counts for the actor's powers
  assert.equal(runCh([{ kind: 'channel-perm', cid: OWN, permsid: 'i_client_permission_modify_power', value: { permvalue: 1 } }], { base }).after.verdict, 'denied');
});

test('channel changes need the channel context', () => {
  assert.throws(() => run([{ kind: 'channel-perm', cid: TCH, permsid: KICK, value: null }]), /input.channels/);
});
