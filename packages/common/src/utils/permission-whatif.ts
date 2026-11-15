import { evaluatePermissionAction, type PermissionActionInput, type PermissionVerdict } from './permission-action.js';

// "What if" for the Why? helper (R11 stage 4): the same evaluation, run once on the overview rows as
// TeamSpeak reports them and once on a copy changed by planned edits. Nothing is written anywhere.
// Covered: server group membership (tier 1), server group (1) and client (2) values, a client's channel
// group in a channel (4), channel group (4), channel (3) and channel-client (5) values. Measured on
// 6.0.0-beta13.1 (ts6-cq-test):
//  - id1/id2 per tier: 1 = sgid, 2 = cldbid, 3 = cid, 4 = cid/cgid, 5 = cid/cldbid;
//  - the *permlist -permsid commands carry permnegated and permskip per row;
//  - a client without any server group is in the virtual server's default group; TeamSpeak drops it from
//    there when the first other group is added and puts it back when the last one is removed;
//  - a client has exactly ONE channel group per channel: assigning one replaces the previous one there
//    (no rows of the old group left); without an assignment it is the default channel group, and setting
//    the default group again removes the assignment. Template channel groups cannot be assigned (2560).

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
  | { kind: 'client-perm'; who: WhatIfWho; permsid: string; value: WhatIfValue | null }
  /** Give a client this channel group in this channel (the default channel group = no assignment). */
  | { kind: 'channel-group-member'; who: WhatIfWho; cid: number; cgid: number }
  /** A channel group's value; counts in every channel where actor or target has that group (after the changes). */
  | { kind: 'channel-group-perm'; cgid: number; permsid: string; value: WhatIfValue | null }
  | { kind: 'channel-perm'; cid: number; permsid: string; value: WhatIfValue | null }
  | { kind: 'channel-client-perm'; who: WhatIfWho; cid: number; permsid: string; value: WhatIfValue | null };

export const WHATIF_MAX_CHANGES = 20;

export interface WhatIfGroupPerm { permsid: string; permvalue: number; permnegated: number; permskip: number }

export interface WhatIfChannels {
  /** The channel each overview list of the base input was read in. */
  cids: { actorInOwnChannel: number; actorInTargetChannel?: number; actorInDestination?: number; target: number };
  defaultCgid: number;
  /** Current channel group of actor and target per channel; a channel not listed = the default channel group. */
  groups: Record<WhatIfWho, Record<number, number>>;
  /** channelgrouppermlist of every channel group a change assigns (only regular groups can be assigned). */
  groupPerms: Record<number, WhatIfGroupPerm[]>;
}

export interface WhatIfInput {
  base: PermissionActionInput<WhatIfRow>;
  changes: WhatIfChange[];
  actor: { cldbid: number; groups: number[] };
  target: { cldbid: number; groups: number[] };
  defaultSgid: number;
  /** servergrouppermlist of every group a change adds or edits (and of the default group). */
  groupPerms: Record<number, WhatIfGroupPerm[]>;
  /** Needed as soon as a change is about channels. */
  channels?: WhatIfChannels;
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
  /** Channel group changes that apply in a channel the answer reads. */
  channelGroups: { who: WhatIfWho; cid: number; before: number; after: number }[];
  /** Indexes of channel changes that touch no channel the answer reads (they cannot change it). */
  unused: number[];
}

type Of<K extends WhatIfChange['kind']> = Extract<WhatIfChange, { kind: K }>;
const isKind = <K extends WhatIfChange['kind']>(k: K) => (c: WhatIfChange): c is Of<K> => c.kind === k;

const keyOf = (c: WhatIfChange): string => {
  switch (c.kind) {
    case 'group-member': return `m:${c.who}:${c.sgid}`;
    case 'group-perm': return `g:${c.sgid}:${c.permsid}`;
    case 'client-perm': return `c:${c.who}:${c.permsid}`;
    case 'channel-group-member': return `cm:${c.who}:${c.cid}`;
    case 'channel-group-perm': return `cg:${c.cgid}:${c.permsid}`;
    case 'channel-perm': return `ch:${c.cid}:${c.permsid}`;
    case 'channel-client-perm': return `cc:${c.who}:${c.cid}:${c.permsid}`;
  }
};

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

type Val = { permvalue: number; permnegated?: number | boolean; permskip?: number | boolean };
const row = (rank: number, id1: number, id2: number, permsid: string, v: Val): WhatIfRow =>
  ({ rank, t: rank - 1, id1, id2, permsid, permvalue: v.permvalue, permnegated: v.permnegated ? 1 : 0, permskip: v.permskip ? 1 : 0 });

/** One client's overview rows (read in channel `cid`) as they would be after the changes. */
function rewrite(rows: WhatIfRow[], cldbid: number, who: WhatIfWho, cid: number | undefined, before: number[], after: number[],
  input: WhatIfInput, cg: { now: number; then: number } | undefined): WhatIfRow[] {
  const { changes, groupPerms } = input;
  const groupEdits = changes.filter(isKind('group-perm'));
  const clientEdits = changes.filter(isKind('client-perm')).filter((e) => e.who === who);
  const cgEdits = cg ? changes.filter(isKind('channel-group-perm')).filter((e) => e.cgid === cg.then) : [];
  const chEdits = changes.filter(isKind('channel-perm')).filter((e) => e.cid === cid);
  const ccEdits = changes.filter(isKind('channel-client-perm')).filter((e) => e.who === who && e.cid === cid);
  const cgSwitched = !!cg && cg.now !== cg.then;

  const out = rows.filter((r) => {
    if (r.rank === 1) return after.includes(r.id1) && !groupEdits.some((e) => e.sgid === r.id1 && e.permsid === r.permsid);
    if (r.rank === 2) return !clientEdits.some((e) => e.permsid === r.permsid);
    if (r.rank === 3) return !chEdits.some((e) => e.permsid === r.permsid);
    if (r.rank === 4) return !cgSwitched && !cgEdits.some((e) => e.permsid === r.permsid);
    if (r.rank === 5) return !ccEdits.some((e) => e.permsid === r.permsid);
    return true;
  });
  for (const sgid of after.filter((g) => !before.includes(g))) {
    for (const p of groupPerms[sgid] ?? []) {
      if (!groupEdits.some((e) => e.sgid === sgid && e.permsid === p.permsid)) out.push(row(1, sgid, 0, p.permsid, p));
    }
  }
  if (cgSwitched && cid !== undefined) {
    for (const p of input.channels!.groupPerms[cg!.then] ?? []) {
      if (!cgEdits.some((e) => e.permsid === p.permsid)) out.push(row(4, cid, cg!.then, p.permsid, p));
    }
  }
  for (const e of groupEdits) if (e.value && after.includes(e.sgid)) out.push(row(1, e.sgid, 0, e.permsid, e.value));
  for (const e of clientEdits) if (e.value) out.push(row(2, cldbid, 0, e.permsid, e.value));
  if (cid !== undefined) {
    for (const e of chEdits) if (e.value) out.push(row(3, cid, 0, e.permsid, e.value));
    for (const e of cgEdits) if (e.value) out.push(row(4, cid, cg!.then, e.permsid, e.value));
    for (const e of ccEdits) if (e.value) out.push(row(5, cid, cldbid, e.permsid, e.value));
  }
  return out;
}

export function evaluateWhatIf(input: WhatIfInput): WhatIfResult {
  const { base, changes, defaultSgid, groupPerms, channels } = input;
  if (changes.length > WHATIF_MAX_CHANGES) throw new WhatIfError('too-many', WHATIF_MAX_CHANGES);
  const seen = new Set<string>();
  changes.forEach((c, i) => {
    if (seen.has(keyOf(c))) throw new WhatIfError('conflict', i);
    seen.add(keyOf(c));
  });
  if (!channels && changes.some((c) => c.kind.startsWith('channel-'))) throw new Error('channel changes need input.channels');

  const groups = {
    actor: { before: [...input.actor.groups].sort((a, b) => a - b), after: finalGroups('actor', input.actor.groups, changes, defaultSgid, groupPerms) },
    target: { before: [...input.target.groups].sort((a, b) => a - b), after: finalGroups('target', input.target.groups, changes, defaultSgid, groupPerms) },
  };

  // Channel group of a client in a channel, now and after the changes
  const cgNow = (who: WhatIfWho, cid: number) => channels!.groups[who][cid] ?? channels!.defaultCgid;
  changes.forEach((c, i) => {
    if (c.kind !== 'channel-group-member') return;
    if (!channels!.groupPerms[c.cgid]) throw new WhatIfError('invalid-group', i);
    if (cgNow(c.who, c.cid) === c.cgid) throw new WhatIfError('already-member', i);
  });
  const cgThen = (who: WhatIfWho, cid: number) =>
    changes.filter(isKind('channel-group-member')).find((c) => c.who === who && c.cid === cid)?.cgid ?? cgNow(who, cid);
  const cgOf = (who: WhatIfWho, cid: number | undefined) =>
    channels && cid !== undefined ? { now: cgNow(who, cid), then: cgThen(who, cid) } : undefined;

  const cids = channels?.cids;
  const forActor = (rows: WhatIfRow[] | undefined, cid: number | undefined) =>
    rows && rewrite(rows, input.actor.cldbid, 'actor', cid, groups.actor.before, groups.actor.after, input, cgOf('actor', cid));

  let group = base.group;
  if (group) {
    const sgid = group.sgid;
    const edits = changes.filter(isKind('group-perm')).filter((c) => c.sgid === sgid);
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
    actorInOwnChannel: forActor(base.actorInOwnChannel, cids?.actorInOwnChannel)!,
    actorInTargetChannel: forActor(base.actorInTargetChannel, cids?.actorInTargetChannel),
    actorInDestination: forActor(base.actorInDestination, cids?.actorInDestination),
    target: rewrite(base.target, input.target.cldbid, 'target', cids?.target, groups.target.before, groups.target.after, input, cgOf('target', cids?.target)),
    group,
  };

  // Which channels the answer reads, per client
  const read: Record<WhatIfWho, number[]> = { actor: [], target: [] };
  if (cids) {
    const lists = [[base.actorInOwnChannel, cids.actorInOwnChannel], [base.actorInTargetChannel, cids.actorInTargetChannel],
      [base.actorInDestination, cids.actorInDestination]] as const;
    for (const [rows, cid] of lists) if (rows && cid !== undefined && !read.actor.includes(cid)) read.actor.push(cid);
    read.target.push(cids.target);
  }
  const reads = (who: WhatIfWho, cid: number) => read[who].includes(cid);
  const unused: number[] = [];
  changes.forEach((c, i) => {
    const hit = c.kind === 'channel-group-member' || c.kind === 'channel-client-perm' ? reads(c.who, c.cid)
      : c.kind === 'channel-perm' ? reads('actor', c.cid) || reads('target', c.cid)
      : c.kind === 'channel-group-perm' ? (['actor', 'target'] as const).some((w) => read[w].some((cid) => cgThen(w, cid) === c.cgid))
      : true;
    if (!hit) unused.push(i);
  });
  const channelGroups = changes.filter(isKind('channel-group-member')).filter((c) => reads(c.who, c.cid))
    .map((c) => ({ who: c.who, cid: c.cid, before: cgNow(c.who, c.cid), after: c.cgid }));

  return { before: evaluatePermissionAction(base), after: evaluatePermissionAction(planned), groups, channelGroups, unused };
}
