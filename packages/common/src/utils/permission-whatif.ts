import { evaluatePermissionAction, type PermissionActionInput, type PermissionVerdict } from './permission-action.js';

// "What if" for the Why? helper (R11 stage 4): the same evaluation, run once on the overview rows as
// TeamSpeak reports them and once on a copy changed by planned edits. Nothing is written anywhere.
// V1 covers what does not depend on a channel: server group membership (tier 1) and permission values of
// server groups (tier 1) and clients (tier 2). Measured on 6.0.0-beta13.1 (ts6-cq-test):
//  - a tier 1 row's id1 is the server group id, a tier 2 row's id1 the client's database id (tier 3: id1 =
//    channel id; tier 4: id1/id2 = channel id/channel group id - not simulated here);
//  - servergrouppermlist -permsid carries permnegated and permskip per row;
//  - a client without any group is in the virtual server's default group; TeamSpeak drops it from there
//    when the first other group is added and puts it back when the last one is removed.

/** One permoverview row (t = permoverview tier 0-4, rank = 1-5). */
export interface WhatIfRow {
  rank: number; t: number; id1: number; id2: number;
  permsid: string; permvalue: number; permnegated: number; permskip: number;
}
export type WhatIfWho = 'actor' | 'target';
export interface WhatIfValue { permvalue: number; permnegated?: boolean; permskip?: boolean }

export type WhatIfChange =
  | { kind: 'group-member'; who: WhatIfWho; sgid: number; op: 'add' | 'remove' }
  /** A server group's value; null removes it. Hits actor and target alike when they are (after the changes) members. */
  | { kind: 'group-perm'; sgid: number; permsid: string; value: WhatIfValue | null }
  | { kind: 'client-perm'; who: WhatIfWho; permsid: string; value: WhatIfValue | null };

export const WHATIF_MAX_CHANGES = 20;

export interface WhatIfGroupPerm { permsid: string; permvalue: number; permnegated: number; permskip: number }

export interface WhatIfInput {
  base: PermissionActionInput<WhatIfRow>;
  changes: WhatIfChange[];
  actor: { cldbid: number; groups: number[] };
  target: { cldbid: number; groups: number[] };
  defaultSgid: number;
  /** servergrouppermlist of every group a change adds or edits (and of the default group). */
  groupPerms: Record<number, WhatIfGroupPerm[]>;
}

export type WhatIfProblem = 'too-many' | 'conflict' | 'already-member' | 'not-member' | 'default-group' | 'invalid-group';
export class WhatIfError extends Error {
  constructor(public problem: WhatIfProblem, public index: number) { super(`change ${index + 1}: ${problem}`); }
}

export interface WhatIfResult {
  before: PermissionVerdict<WhatIfRow>;
  after: PermissionVerdict<WhatIfRow>;
  /** Server groups of actor and target before and after (the default group included). */
  groups: Record<WhatIfWho, { before: number[]; after: number[] }>;
}

const keyOf = (c: WhatIfChange) =>
  c.kind === 'group-member' ? `m:${c.who}:${c.sgid}` : c.kind === 'group-perm' ? `g:${c.sgid}:${c.permsid}` : `c:${c.who}:${c.permsid}`;

function finalGroups(who: WhatIfWho, now: number[], changes: WhatIfChange[], defaultSgid: number, groupPerms: WhatIfInput['groupPerms']): number[] {
  const set = new Set(now);
  changes.forEach((c, i) => {
    if (c.kind !== 'group-member' || c.who !== who) return;
    if (c.sgid === defaultSgid) throw new WhatIfError('default-group', i);
    if (c.op === 'add') {
      if (set.has(c.sgid)) throw new WhatIfError('already-member', i);
      if (!groupPerms[c.sgid]) throw new WhatIfError('invalid-group', i);
      set.add(c.sgid);
    } else {
      if (!set.has(c.sgid)) throw new WhatIfError('not-member', i);
      set.delete(c.sgid);
    }
  });
  set.delete(defaultSgid);
  if (set.size === 0) set.add(defaultSgid);
  return [...set].sort((a, b) => a - b);
}

/** The planned rows for one client: tier 1 from the final groups, tier 2 with the client's edits, tiers 3-5 untouched. */
function rewrite(rows: WhatIfRow[], cldbid: number, before: number[], after: number[], who: WhatIfWho,
  changes: WhatIfChange[], groupPerms: WhatIfInput['groupPerms']): WhatIfRow[] {
  const groupEdits = changes.filter((c): c is Extract<WhatIfChange, { kind: 'group-perm' }> => c.kind === 'group-perm');
  const clientEdits = changes.filter((c): c is Extract<WhatIfChange, { kind: 'client-perm' }> => c.kind === 'client-perm' && c.who === who);
  const row = (rank: 1 | 2, id1: number, permsid: string, v: { permvalue: number; permnegated?: number | boolean; permskip?: number | boolean }): WhatIfRow =>
    ({ rank, t: rank - 1, id1, id2: 0, permsid, permvalue: v.permvalue, permnegated: v.permnegated ? 1 : 0, permskip: v.permskip ? 1 : 0 });

  const out = rows.filter((r) => {
    if (r.rank === 1) return after.includes(r.id1) && !groupEdits.some((e) => e.sgid === r.id1 && e.permsid === r.permsid);
    if (r.rank === 2) return !clientEdits.some((e) => e.permsid === r.permsid);
    return true;
  });
  for (const sgid of after.filter((g) => !before.includes(g))) {
    for (const p of groupPerms[sgid] ?? []) {
      if (!groupEdits.some((e) => e.sgid === sgid && e.permsid === p.permsid)) out.push(row(1, sgid, p.permsid, p));
    }
  }
  for (const e of groupEdits) if (e.value && after.includes(e.sgid)) out.push(row(1, e.sgid, e.permsid, e.value));
  for (const e of clientEdits) if (e.value) out.push(row(2, cldbid, e.permsid, e.value));
  return out;
}

export function evaluateWhatIf(input: WhatIfInput): WhatIfResult {
  const { base, changes, defaultSgid, groupPerms } = input;
  if (changes.length > WHATIF_MAX_CHANGES) throw new WhatIfError('too-many', WHATIF_MAX_CHANGES);
  const seen = new Set<string>();
  changes.forEach((c, i) => {
    if (seen.has(keyOf(c))) throw new WhatIfError('conflict', i);
    seen.add(keyOf(c));
  });
  const groups = {
    actor: { before: [...input.actor.groups].sort((a, b) => a - b), after: finalGroups('actor', input.actor.groups, changes, defaultSgid, groupPerms) },
    target: { before: [...input.target.groups].sort((a, b) => a - b), after: finalGroups('target', input.target.groups, changes, defaultSgid, groupPerms) },
  };
  const forActor = (rows: WhatIfRow[] | undefined) =>
    rows && rewrite(rows, input.actor.cldbid, groups.actor.before, groups.actor.after, 'actor', changes, groupPerms);

  let group = base.group;
  if (group) {
    const sgid = group.sgid;
    const edits = changes.filter((c) => c.kind === 'group-perm' && c.sgid === sgid) as Extract<WhatIfChange, { kind: 'group-perm' }>[];
    group = {
      sgid,
      targetIsMember: groups.target.after.includes(sgid),
      perms: [
        ...group.perms.filter((p) => !edits.some((e) => e.permsid === p.permsid)),
        ...edits.filter((e) => e.value).map((e) => ({ permsid: e.permsid, permvalue: e.value!.permvalue })),
      ],
    };
  }
  const planned: PermissionActionInput<WhatIfRow> = {
    ...base,
    actorInOwnChannel: forActor(base.actorInOwnChannel)!,
    actorInTargetChannel: forActor(base.actorInTargetChannel),
    actorInDestination: forActor(base.actorInDestination),
    target: rewrite(base.target, input.target.cldbid, groups.target.before, groups.target.after, 'target', changes, groupPerms),
    group,
  };
  return { before: evaluatePermissionAction(base), after: evaluatePermissionAction(planned), groups };
}
