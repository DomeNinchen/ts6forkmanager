import { resolvePermissionOverview, type OverviewSource } from './permission-overview.js';

// "Can client X do action Y to client Z?" from permoverview rows (R11). Each rule below was measured on a
// TeamSpeak 6 server (6.0.0-beta13.1) with real voice clients, allowed / refused / equal-value cases:
//  - every pair passes when power >= needed power (equal is enough; unset counts as 0, so 0 vs 0 passes);
//  - an action on an online client (kick, ban by clid, poke, private message) evaluates the actor in the
//    TARGET's channel: a channel-scoped grant elsewhere does not count. The target's needed value counts in
//    its own channel too;
//  - move: the actor's move power must hold in the target's channel AND in the destination channel; the
//    target's needed move power counts in its own channel. Join rights on the destination are checked as
//    well (not judged here, see the note);
//  - server group add/remove and a ban by identity (target offline) evaluate the actor in the ACTOR's own
//    channel; group add/remove also needs i_client_permission_modify_power >= the target's
//    i_client_needed_permission_modify_power, where only the target's server groups and client
//    permissions count (tiers 1-2: a channel group or channel-client value of the target is ignored);
//  - a ban needs i_client_ban_max_bantime of -1 (no limit) or at least the duration; a permanent ban
//    (duration 0) needs -1. Banning an online client does not check b_client_ban_create, banning by
//    identity does, and skips the ban power pair.

export const PERMISSION_ACTIONS = [
  'kick-server', 'kick-channel', 'ban', 'move', 'poke', 'message-private', 'group-add', 'group-remove',
] as const;
export type PermissionAction = typeof PERMISSION_ACTIONS[number];

/** Actions that need the target to be online (they address a connected client). */
const ONLINE_ONLY: ReadonlySet<PermissionAction> = new Set(['kick-server', 'kick-channel', 'move', 'poke', 'message-private']);

/** Where a value was read: the actor's own channel, the target's channel, the move destination, or the target's server-wide value. */
export type PermissionScope = 'actor-channel' | 'target-channel' | 'destination' | 'server';

export interface PermissionValue<T extends OverviewSource = OverviewSource> {
  permission: string;
  value: number;
  scope: PermissionScope;
  /** The overview row that decides the value; null when nothing sets it (counts as 0). */
  source: T | null;
}

export interface PermissionCheck<T extends OverviewSource = OverviewSource> {
  kind: 'power' | 'flag' | 'ban-time';
  ok: boolean;
  have: PermissionValue<T>;
  /** For 'power': the needed value (the target's, or the group's own for group actions). */
  need?: PermissionValue<T> | { permission: string; value: number; scope: 'group'; source: null; sgid: number };
  /** For 'ban-time': the ban duration asked about, in seconds (0 = permanent). */
  duration?: number;
}

export type PermissionNote = 'target-offline' | 'already-member' | 'not-member' | 'move-join-not-checked'
  | 'move-same-channel' | 'actor-offline-default-channel';

export interface PermissionVerdict<T extends OverviewSource = OverviewSource> {
  action: PermissionAction;
  /** 'impossible': the action cannot be done at all in this situation (target offline, already a member ...). */
  verdict: 'allowed' | 'denied' | 'impossible';
  checks: PermissionCheck<T>[];
  notes: PermissionNote[];
}

export interface PermissionActionInput<T extends OverviewSource = OverviewSource> {
  action: PermissionAction;
  targetOnline: boolean;
  actorOnline: boolean;
  /** Actor overview in its own channel (its current one, or the default channel when offline). */
  actorInOwnChannel: T[];
  /** Actor overview in the target's channel (online target). */
  actorInTargetChannel?: T[];
  /** Actor overview in the move destination. */
  actorInDestination?: T[];
  /** Target overview in its channel (online), or any channel (offline: only tiers 1-2 are used). */
  target: T[];
  /** Group actions: the group's own permissions (servergrouppermlist) and whether the target is a member. */
  group?: { sgid: number; perms: { permsid: string; permvalue: number }[]; targetIsMember: boolean };
  /** Ban duration in seconds, 0 = permanent. */
  banDuration?: number;
  /** Move: whether the destination is the channel the target is already in. */
  destinationIsTargetChannel?: boolean;
}

function valueOf<T extends OverviewSource>(rows: T[], permission: string, scope: PermissionScope): PermissionValue<T> {
  const hit = resolvePermissionOverview(rows.filter((r) => r.permsid === permission))[0];
  return { permission, scope, value: hit ? hit.winner.permvalue : 0, source: hit ? hit.winner : null };
}

const power = <T extends OverviewSource>(have: PermissionValue<T>, need: PermissionCheck<T>['need'] & {}): PermissionCheck<T> =>
  ({ kind: 'power', ok: have.value >= need.value, have, need });

export function banTimeAllows(maxBantime: number, duration: number): boolean {
  return maxBantime === -1 || (duration > 0 && duration <= maxBantime);
}

export function evaluatePermissionAction<T extends OverviewSource>(input: PermissionActionInput<T>): PermissionVerdict<T> {
  const { action } = input;
  const checks: PermissionCheck<T>[] = [];
  const notes: PermissionNote[] = [];
  if (!input.actorOnline) notes.push('actor-offline-default-channel');
  const done = (impossible = false): PermissionVerdict<T> => ({
    action, checks, notes,
    verdict: impossible ? 'impossible' : checks.every((c) => c.ok) ? 'allowed' : 'denied',
  });
  if (ONLINE_ONLY.has(action) && !input.targetOnline) { notes.push('target-offline'); return done(true); }

  const inTarget = input.actorInTargetChannel ?? [];
  const pair = (p: string, n: string, actorRows: T[], actorScope: PermissionScope) =>
    power(valueOf(actorRows, p, actorScope), valueOf(input.target, n, 'target-channel'));

  switch (action) {
    case 'kick-server':
      checks.push(pair('i_client_kick_from_server_power', 'i_client_needed_kick_from_server_power', inTarget, 'target-channel'));
      break;
    case 'kick-channel':
      checks.push(pair('i_client_kick_from_channel_power', 'i_client_needed_kick_from_channel_power', inTarget, 'target-channel'));
      break;
    case 'poke':
      checks.push(pair('i_client_poke_power', 'i_client_needed_poke_power', inTarget, 'target-channel'));
      break;
    case 'message-private':
      checks.push(pair('i_client_private_textmessage_power', 'i_client_needed_private_textmessage_power', inTarget, 'target-channel'));
      break;
    case 'move': {
      if (input.destinationIsTargetChannel) { notes.push('move-same-channel'); return done(true); }
      checks.push(pair('i_client_move_power', 'i_client_needed_move_power', inTarget, 'target-channel'));
      checks.push(power(valueOf(input.actorInDestination ?? [], 'i_client_move_power', 'destination'),
        valueOf(input.target, 'i_client_needed_move_power', 'target-channel')));
      notes.push('move-join-not-checked');
      break;
    }
    case 'ban': {
      const duration = input.banDuration ?? 0;
      const actorRows = input.targetOnline ? inTarget : input.actorInOwnChannel;
      const scope: PermissionScope = input.targetOnline ? 'target-channel' : 'actor-channel';
      if (input.targetOnline) checks.push(pair('i_client_ban_power', 'i_client_needed_ban_power', inTarget, 'target-channel'));
      else {
        const create = valueOf(actorRows, 'b_client_ban_create', scope);
        checks.push({ kind: 'flag', ok: create.value >= 1, have: create });
      }
      const max = valueOf(actorRows, 'i_client_ban_max_bantime', scope);
      checks.push({ kind: 'ban-time', ok: banTimeAllows(max.value, duration), have: max, duration });
      break;
    }
    case 'group-add':
    case 'group-remove': {
      const g = input.group;
      if (!g) throw new Error(`${action} needs a group`);
      if (action === 'group-add' && g.targetIsMember) notes.push('already-member');
      if (action === 'group-remove' && !g.targetIsMember) notes.push('not-member');
      const [p, n] = action === 'group-add'
        ? ['i_group_member_add_power', 'i_group_needed_member_add_power']
        : ['i_group_member_remove_power', 'i_group_needed_member_remove_power'];
      const groupNeed = g.perms.find((x) => x.permsid === n);
      checks.push(power(valueOf(input.actorInOwnChannel, p, 'actor-channel'),
        { permission: n, value: groupNeed ? Number(groupNeed.permvalue) : 0, scope: 'group', source: null, sgid: g.sgid }));
      const serverLevel = input.target.filter((r) => r.rank <= 2);
      checks.push(power(valueOf(input.actorInOwnChannel, 'i_client_permission_modify_power', 'actor-channel'),
        valueOf(serverLevel, 'i_client_needed_permission_modify_power', 'server')));
      if (notes.includes('already-member') || notes.includes('not-member')) return done(true);
      break;
    }
  }
  return done();
}
