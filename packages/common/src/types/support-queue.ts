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

  // ---- messages (stage 3) ----
  /** Private messages to the waiting client: on entering (with the position) and when taken. */
  clientMessages: boolean;
  /** On entering while a supporter is available. Placeholders: {client} {position} {waiting} {estimate}. */
  enterText: string;
  /** On entering while no supporter is available (his decision 5: say it honestly). Same placeholders. */
  noSupporterText: string;
  /** What {estimate} becomes once there are enough taken cases; empty before. Placeholder: {minutes}. */
  estimateText: string;
  /** When taken. Placeholders: {client} {supporter}. */
  takenText: string;
  /** Repeat the position every N minutes while waiting; 0 = off. */
  repeatMin: number;
  /** Poke the available supporters when a new case arrives. */
  pokeSupporters: boolean;
  /** Poke text (TeamSpeak cuts pokes at 100 characters). Placeholders: {client} {position} {waiting}. */
  supporterPokeText: string;
  /** Poke the available supporters once more when a case has waited this long. */
  remind: boolean;
  remindAfterMin: number;
  /** Placeholders: {client} {position} {waited} (minutes). */
  remindText: string;
}

export const SUPPORT_QUEUE_DEFAULTS: SupportQueueSettings = {
  supporterGroupIds: [],
  afkChannelIds: [],
  graceSec: 60,
  queueWithoutSupporter: true,
  roomName: 'Support: {client}',
  roomType: 'temporary',
  clientMessages: true,
  enterText: 'Hello {client}, you are number {position} in the support queue.{estimate}',
  noSupporterText: 'Hello {client}, you are number {position} in the support queue. No supporter is available right now; please stay in the channel.',
  estimateText: ' Usual waiting time: about {minutes} min.',
  takenText: 'Hello {client}, {supporter} is taking care of you now.',
  repeatMin: 0,
  pokeSupporters: true,
  supporterPokeText: 'Support: {client} is waiting (number {position})',
  remind: false,
  remindAfterMin: 5,
  remindText: 'Support: {client} has been waiting for {waited} min',
};

export const SUPPORT_GRACE_MAX_SEC = 3600;
/** Measured on TeamSpeak 6 (R13): a private message arrives complete up to 2000 characters, a poke takes 100. */
export const SUPPORT_TEXT_MAX = 1000;
export const SUPPORT_POKE_MAX = 100;
export const SUPPORT_REPEAT_MAX_MIN = 60;
export const SUPPORT_REMIND_MAX_MIN = 240;
/** The estimate needs this many taken cases, and looks at the last SUPPORT_ESTIMATE_SAMPLE of them. */
export const SUPPORT_ESTIMATE_MIN_CASES = 10;
export const SUPPORT_ESTIMATE_SAMPLE = 50;
/** How long ended cases are kept (his decision 9). */
export const SUPPORT_RETENTION_MIN_DAYS = 1;
export const SUPPORT_RETENTION_MAX_DAYS = 3650;
export const SUPPORT_RETENTION_DEFAULT_DAYS = 90;
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
  for (const k of ['clientMessages', 'pokeSupporters', 'remind'] as const) if (typeof s[k] !== 'boolean') return `${k} must be true or false`;
  for (const k of ['enterText', 'noSupporterText', 'takenText', 'supporterPokeText', 'remindText'] as const) {
    if (typeof s[k] !== 'string' || !s[k].trim() || [...s[k]].length > SUPPORT_TEXT_MAX) return `${k} must be 1 to ${SUPPORT_TEXT_MAX} characters`;
  }
  // May be empty: then no estimate is ever added.
  if (typeof s.estimateText !== 'string' || [...s.estimateText].length > SUPPORT_TEXT_MAX) return `estimateText must be at most ${SUPPORT_TEXT_MAX} characters`;
  if (!Number.isInteger(s.repeatMin) || s.repeatMin < 0 || s.repeatMin > SUPPORT_REPEAT_MAX_MIN) return `repeatMin must be 0 to ${SUPPORT_REPEAT_MAX_MIN} minutes`;
  if (!Number.isInteger(s.remindAfterMin) || s.remindAfterMin < 1 || s.remindAfterMin > SUPPORT_REMIND_MAX_MIN) return `remindAfterMin must be 1 to ${SUPPORT_REMIND_MAX_MIN} minutes`;
  return null;
}

// ---- texts, estimate, statistics (stage 3) ----------------------------------

/** Fills {name} placeholders; unknown ones stay as they are. Cut to `max` characters, marking the cut. */
export function renderSupportText(text: string, values: Record<string, string | number>, max: number): string {
  const out = text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
  const chars = [...out];
  return chars.length <= max ? out : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * The usual waiting time in whole minutes (at least 1): the median of the given waits (ms), or null below
 * SUPPORT_ESTIMATE_MIN_CASES. Not scaled by the position (his choice): with several supporters a
 * "position x median" figure would be far off.
 */
export function supportEstimateMin(waitsMs: number[]): number | null {
  if (waitsMs.length < SUPPORT_ESTIMATE_MIN_CASES) return null;
  const sorted = [...waitsMs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.max(1, Math.round(median / 60_000));
}

export interface SupportStats {
  cases: number;
  taken: number;
  done: number;
  cancelled: number;
  /** Over taken cases with a known arrival; null when there is none. */
  avgWaitMs: number | null;
  maxWaitMs: number | null;
  /** A case taken by several supporters counts for each of them (his decision 11). */
  perSupporter: Array<{ uid: string; nickname: string; cases: number; perDay: number }>;
  /** Newest day first; `day` as the caller's dayKey gives it. */
  perDay: Array<{ day: string; cases: number; taken: number; cancelled: number; avgWaitMs: number | null }>;
}

/**
 * Figures over ended cases. `dayKey` turns a time into a day label (the page passes one in the viewer's
 * own time zone); `days` is the length of the period, for the per-day average of each supporter.
 */
export function supportStats(cases: SupportCaseEntry[], days: number, dayKey: (ms: number) => string): SupportStats {
  const waitOf = (k: SupportCaseEntry) => (k.takenAt && !k.arrivalUnknown ? Date.parse(k.takenAt) - Date.parse(k.arrivedAt) : null);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const waits = cases.map(waitOf).filter((w): w is number => w !== null);
  const people = new Map<string, { uid: string; nickname: string; cases: number; perDay: number }>();
  for (const k of cases) {
    for (const p of k.takenBy) {
      const e = people.get(p.uid) ?? { uid: p.uid, nickname: p.nickname, cases: 0, perDay: 0 };
      e.cases++;
      people.set(p.uid, e);
    }
  }
  for (const e of people.values()) e.perDay = Math.round((e.cases / Math.max(1, days)) * 10) / 10;
  const byDay = new Map<string, SupportCaseEntry[]>();
  for (const k of cases) {
    const d = dayKey(Date.parse(k.arrivedAt));
    byDay.set(d, [...(byDay.get(d) ?? []), k]);
  }
  return {
    cases: cases.length,
    taken: cases.filter((k) => k.takenAt).length,
    done: cases.filter((k) => k.state === 'done').length,
    cancelled: cases.filter((k) => k.state === 'cancelled').length,
    avgWaitMs: avg(waits),
    maxWaitMs: waits.length ? Math.max(...waits) : null,
    perSupporter: [...people.values()].sort((a, b) => b.cases - a.cases || a.nickname.localeCompare(b.nickname)),
    perDay: [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, ks]) => ({
        day,
        cases: ks.length,
        taken: ks.filter((k) => k.takenAt).length,
        cancelled: ks.filter((k) => k.state === 'cancelled').length,
        avgWaitMs: avg(ks.map(waitOf).filter((w): w is number => w !== null)),
      })),
  };
}

/** The room name with {client} and {supporter} filled in, cut to TeamSpeak's channel name limit. */
export function supportRoomName(template: string, client: string, supporter: string): string {
  const name = template.replace(/\{client\}/g, client).replace(/\{supporter\}/g, supporter);
  return [...name].slice(0, SUPPORT_ROOM_NAME_MAX).join('');
}
