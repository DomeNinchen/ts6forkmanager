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
