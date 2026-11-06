// Support queue (R14): whoever enters a virtual server's waiting channel gets a case with a fixed place
// in line. The backend reads the client list every few seconds and moves each case along from what it
// sees in TeamSpeak; a supporter can also take a case in the web UI.

/**
 * - `waiting`: in the waiting channel (or away from it for less than the grace period).
 * - `in-progress`: taken - the client is in a channel with a supporter, or was taken in the web UI.
 * - `done`: taken and over (no longer with a supporter for longer than the grace period, or left the server).
 * - `cancelled`: ended before anyone took it (left for longer than the grace period, or removed in the web UI).
 */
export const SUPPORT_CASE_STATES = ['waiting', 'in-progress', 'done', 'cancelled'] as const;
export type SupportCaseState = (typeof SUPPORT_CASE_STATES)[number];
export const SUPPORT_OPEN_STATES: readonly SupportCaseState[] = ['waiting', 'in-progress'];

/** How a case ended. */
export const SUPPORT_END_REASONS = [
  'left-server',      // the client disconnected and did not come back within the grace period
  'left-channel',     // waiting: the client went elsewhere (no supporter there) and did not come back in time
  'finished',         // taken: the client was no longer with a supporter for longer than the grace period
  'removed',          // a user removed the waiting client in the web UI (the client is moved out of the channel)
  'closed',           // a user marked a taken case as done in the web UI
  'queue-changed',    // the queue was switched off or got another waiting channel
] as const;
export type SupportEndReason = (typeof SUPPORT_END_REASONS)[number];

/** A supporter as the client list showed them. */
export interface SupportPerson {
  uid: string;
  nickname: string;
  cldbid: number;
}

export interface SupportCaseEntry {
  id: number;
  queueId: number;
  clientUid: string;
  cldbid: number;
  /** The nickname as last seen. */
  nickname: string;
  /** ISO 8601. */
  arrivedAt: string;
  /** The client was already waiting when the backend started, so the real arrival is not known (arrivedAt = start). */
  arrivalUnknown: boolean;
  state: SupportCaseState;
  /** 1-based place among the waiting cases; null for any other state. */
  position: number | null;
  /** Since when the client is missing (away from the waiting channel, or away from every supporter once taken). */
  absentSince: string | null;
  takenAt: string | null;
  /** Every supporter in the channel when it was taken; all of them are credited (his decision 11). */
  takenBy: SupportPerson[];
  /** 'teamspeak': seen in TeamSpeak; 'web': taken in the web UI. */
  takenVia: 'teamspeak' | 'web' | null;
  /** The web user who took, removed or closed it. */
  actedBy: string | null;
  /** The room created for a web take-over. */
  roomCid: number | null;
  endedAt: string | null;
  endReason: SupportEndReason | null;
}

export type SupportRoomType = 'temporary' | 'semipermanent' | 'permanent';

/** Per queue; stored as JSON next to the queue's channel. */
export interface SupportQueueSettings {
  /** Members of any of these server groups are supporters (and are never queued themselves). */
  supporterGroupIds: number[];
  /** Supporters in these channels do not count as available, and do not take cases there. */
  afkChannelIds: number[];
  /** How long a client may be gone (disconnect, other channel) and keep their place. */
  graceSec: number;
  /** false: nobody is queued while no supporter is available. */
  queueWithoutSupporter: boolean;
  /** Name of the room a web take-over creates; {client} and {supporter} are filled in. */
  roomName: string;
  roomType: SupportRoomType;
}

export const SUPPORT_QUEUE_DEFAULTS: SupportQueueSettings = {
  supporterGroupIds: [],
  afkChannelIds: [],
  graceSec: 60,
  queueWithoutSupporter: true,
  roomName: 'Support: {client}',
  roomType: 'temporary',
};

export const SUPPORT_GRACE_MAX_SEC = 3600;
/** TeamSpeak's limit for a channel name. */
export const SUPPORT_ROOM_NAME_MAX = 40;

export interface SupportQueueConfig {
  id: number | null;
  enabled: boolean;
  /** The waiting channel; 0 while not set up. */
  channelId: number;
  settings: SupportQueueSettings;
}

/** An enabled flow on the same virtual server that reacts to the same waiting channel. */
export interface SupportQueueConflict {
  flowId: number;
  name: string;
}

export interface SupportQueueStatus {
  /** Why the queue is not following TeamSpeak right now (connection off, server unreachable); null when it is. */
  paused: string | null;
  pausedSince: string | null;
  /** ISO 8601 of the last successful look at the client list. */
  checkedAt: string | null;
  /** Supporters online and available (not away, not in an AFK channel). */
  supporters: Array<SupportPerson & { clid: number; cid: number }>;
}

export interface SupportQueueView {
  config: SupportQueueConfig;
  status: SupportQueueStatus;
  /** Waiting cases in order, then taken ones. */
  cases: SupportCaseEntry[];
}

/** Why a queue paused, as the backend stores it (English); a reason with a detail is `<text>: <detail>`. */
export const SUPPORT_PAUSE_NOTES = {
  connectionInactive: 'The server connection is not active',
  unreachable: 'TeamSpeak could not be reached',
} as const;

/** null when the settings are acceptable, otherwise the reason. */
export function supportSettingsProblem(s: SupportQueueSettings): string | null {
  const ids = (v: unknown) => Array.isArray(v) && v.length <= 50 && v.every((n) => Number.isInteger(n) && n > 0);
  if (!ids(s.supporterGroupIds)) return 'supporterGroupIds must be a list of server group ids';
  if (!ids(s.afkChannelIds)) return 'afkChannelIds must be a list of channel ids';
  if (!Number.isInteger(s.graceSec) || s.graceSec < 0 || s.graceSec > SUPPORT_GRACE_MAX_SEC) return `graceSec must be 0 to ${SUPPORT_GRACE_MAX_SEC} seconds`;
  if (typeof s.queueWithoutSupporter !== 'boolean') return 'queueWithoutSupporter must be true or false';
  if (typeof s.roomName !== 'string' || !s.roomName.trim() || [...s.roomName].length > SUPPORT_ROOM_NAME_MAX) return `roomName must be 1 to ${SUPPORT_ROOM_NAME_MAX} characters`;
  if (!['temporary', 'semipermanent', 'permanent'].includes(s.roomType)) return 'roomType must be temporary, semipermanent or permanent';
  return null;
}

/** The room name with {client} and {supporter} filled in, cut to TeamSpeak's channel name limit. */
export function supportRoomName(template: string, client: string, supporter: string): string {
  const name = template.replace(/\{client\}/g, client).replace(/\{supporter\}/g, supporter);
  return [...name].slice(0, SUPPORT_ROOM_NAME_MAX).join('');
}
