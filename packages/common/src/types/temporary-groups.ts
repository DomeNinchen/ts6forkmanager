// Temporary server group memberships (R13): a client is put into a server group until a
// point in time, and the backend takes the group away again once it has passed. TeamSpeak
// itself has no expiry for a membership, so the manager keeps the deadline.

/**
 * Where a temporary membership stands.
 * - `active`: in force, waits for its expiry.
 * - `waiting`: expired, but the connection was not reachable; retried after a pause.
 * - `error`: expired, TeamSpeak refused the removal (e.g. missing power); retried after a pause.
 * - `revoked`: the group was taken away when the time was up (or by "revoke now").
 * - `already-removed`: at expiry the client was no longer in the group, the group or the
 *   client's database entry was gone, or the entry now belongs to another identity - nothing to do.
 * - `permanent`: the deadline was dropped; the membership stays and the manager no longer tracks it.
 */
export const TEMP_GROUP_STATES = ['active', 'waiting', 'error', 'revoked', 'already-removed', 'permanent'] as const;
export type TempGroupState = (typeof TEMP_GROUP_STATES)[number];

/** States whose membership the job still has to end. */
export const TEMP_GROUP_OPEN_STATES: readonly TempGroupState[] = ['active', 'waiting', 'error'];

export function isOpenTempGroupState(state: string): boolean {
  return (TEMP_GROUP_OPEN_STATES as readonly string[]).includes(state);
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The shortest deadline (short enough to try the feature out) and the longest one. */
export const TEMP_GROUP_MIN_DURATION_MS = MINUTE_MS;
export const TEMP_GROUP_MAX_DURATION_MS = 5 * 365 * DAY_MS;

/** How long ended memberships stay listed as history. */
export const TEMP_GROUP_RETENTION_MIN_DAYS = 1;
export const TEMP_GROUP_RETENTION_MAX_DAYS = 3650;
export const TEMP_GROUP_RETENTION_DEFAULT_DAYS = 90;

/**
 * The fixed reasons the job stores in `error` (English, as the change log and the server log read them).
 * A reason with a detail is stored as `<text>: <detail>`; the page translates by the key whose text starts it.
 */
export const TEMP_GROUP_NOTES = {
  connectionInactive: 'The server connection is not active',
  unreachable: 'TeamSpeak could not be reached',
  notMember: 'The client was no longer in the group',
  groupGone: 'The group no longer exists',
  clientGone: "The client's database entry no longer exists",
  otherIdentity: 'The database entry now belongs to another identity; nothing was removed',
  noPower: 'TeamSpeak refused the removal because the connection lacks the power; raise it and the removal is retried',
  teamspeakError: 'TeamSpeak refused the removal',
} as const;
export type TempGroupNoteKey = keyof typeof TEMP_GROUP_NOTES;

/** The note a stored `error` text starts with, and what follows it (a permission name, TeamSpeak's own message). */
export function parseTempGroupNote(text: string): { key: TempGroupNoteKey; detail: string } | null {
  for (const key of Object.keys(TEMP_GROUP_NOTES) as TempGroupNoteKey[]) {
    const note = TEMP_GROUP_NOTES[key];
    if (text === note) return { key, detail: '' };
    if (text.startsWith(`${note}: `)) return { key, detail: text.slice(note.length + 2) };
  }
  return null;
}

/** Which connection gave the group, and so takes it away again. */
export type TempGroupVia = 'main' | 'bot';

export interface TemporaryGroupEntry {
  id: number;
  serverConfigId: number;
  sid: number;
  sgid: number;
  cldbid: number;
  clientUid: string;
  /** The nickname when the group was given (for the list; the client may have renamed since). */
  clientNickname: string;
  /** ISO 8601, UTC. */
  expiresAt: string;
  grantedAt: string;
  grantedBy: string;
  via: TempGroupVia;
  /** The client was already in the group when the deadline was set ("set deadline" on a member). */
  wasMember: boolean;
  state: TempGroupState;
  /** Why the last attempt failed (`waiting`/`error`), or a note on how it ended. */
  error: string | null;
  attempts: number;
  /** ISO 8601; the next try of an open entry. */
  nextAttemptAt: string | null;
  endedAt: string | null;
  /** The last message the client was sent about this membership, if any. */
  lastNotice: TempGroupNoticeRecord | null;
  /** A notice waiting for the client to come online (it was offline when it was due). */
  pendingNotice: TempGroupNoticeKind | null;
}

// ---- notices to the client (stage 3) ----------------------------------------

export type TempGroupNoticeKind = 'warning' | 'expired';
export type TempGroupNoticeChannel = 'message' | 'offline' | 'poke';

/** What was sent, how, and when - kept on the entry for the list. */
export interface TempGroupNoticeRecord {
  kind: TempGroupNoticeKind;
  /** For a warning: how long before the expiry it was due (ms). */
  beforeMs?: number;
  /** ISO 8601. */
  at: string;
  /** The ways it went out; empty when nothing could be sent. */
  sent: TempGroupNoticeChannel[];
  /** The client was offline: a private message/poke follows when they come online. */
  waitingForOnline?: boolean;
  /** Why a way failed (TeamSpeak's words). */
  error?: string;
}

/** Per connection and virtual server: when and how clients hear about their deadline. Admin only. */
export interface TempGroupNoticeSettings {
  enabled: boolean;
  /** Warn this long before the expiry (ms), each once. */
  warnBeforeMs: number[];
  /** Also tell the client when the group was taken away. */
  notifyExpired: boolean;
  privateMessage: boolean;
  offlineMessage: boolean;
  poke: boolean;
  warningText: string;
  expiredText: string;
  /** IANA zone the {expires} placeholder is written in. */
  timeZone: string;
}

export const TEMP_GROUP_NOTICE_DEFAULTS: TempGroupNoticeSettings = {
  enabled: true,
  warnBeforeMs: [7 * 86_400_000, 86_400_000],
  notifyExpired: true,
  privateMessage: true,
  offlineMessage: true,
  poke: false,
  warningText: 'Hello {client}, your server group "{group}" ends on {expires}.',
  expiredText: 'Hello {client}, your server group "{group}" has ended.',
  timeZone: 'UTC',
};

/** Measured on TeamSpeak 6: a poke takes at most 100 characters, an offline message 4096 (subject < 255). */
export const TEMP_GROUP_TEXT_MAX = 1000;
export const TEMP_GROUP_POKE_MAX = 100;
export const TEMP_GROUP_SUBJECT_MAX = 100;
export const TEMP_GROUP_WARN_MAX_ENTRIES = 5;
/** How long an expiry notice waits for an offline client to come back. */
export const TEMP_GROUP_EXPIRED_NOTICE_WAIT_MS = 30 * 86_400_000;

/** The placeholders a notice text may use. */
export const TEMP_GROUP_PLACEHOLDERS = ['client', 'group', 'expires', 'days', 'hours'] as const;

/** "2026-11-07 10:00 Europe/Berlin" - neutral wording, since the client's language is not known. */
export function formatNoticeDate(ms: number, timeZone: string): string {
  // An unknown zone (half typed in the settings form) falls back to UTC instead of throwing.
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const local = new Date(ms).toLocaleString('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `${local} ${zone}`;
}

export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Fills a notice text. {days} and {hours} are what is left, rounded down ({hours} in total). */
export function renderNoticeText(text: string, v: { client: string; group: string; expiresAt: number; now: number; timeZone: string }): string {
  const left = Math.max(0, v.expiresAt - v.now);
  const values: Record<(typeof TEMP_GROUP_PLACEHOLDERS)[number], string> = {
    client: v.client,
    group: v.group,
    expires: formatNoticeDate(v.expiresAt, v.timeZone),
    days: String(Math.floor(left / 86_400_000)),
    hours: String(Math.floor(left / 3_600_000)),
  };
  return text.replace(/\{(client|group|expires|days|hours)\}/g, (_m, key: keyof typeof values) => values[key]);
}

/** Cuts a text to `max` characters, marking the cut. */
export function clipNotice(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * The warning that is due now, as its "before" value, or null. Only warnings that still lay ahead
 * when the deadline was set count (a 3-day deadline gets no "7 days left" warning), each one once
 * (`handledBeforeMs` is the smallest one already dealt with), and only the closest when several are due.
 */
export function dueWarning(warnBeforeMs: number[], expiresAt: number, deadlineSetAt: number, handledBeforeMs: number | null, now: number): number | null {
  if (now >= expiresAt) return null;
  const due = warnBeforeMs.filter((b) => expiresAt - b > deadlineSetAt && now >= expiresAt - b && (handledBeforeMs === null || b < handledBeforeMs));
  return due.length ? Math.min(...due) : null;
}

/** null when the settings are acceptable, otherwise the reason. */
export function noticeSettingsProblem(s: TempGroupNoticeSettings): string | null {
  if (!Array.isArray(s.warnBeforeMs) || s.warnBeforeMs.length > TEMP_GROUP_WARN_MAX_ENTRIES) return `At most ${TEMP_GROUP_WARN_MAX_ENTRIES} warning times`;
  // Whole minutes: the entry stores the handled warning in minutes (a 365-day value in ms does not fit a 32-bit column).
  if (s.warnBeforeMs.some((b) => !Number.isInteger(b) || b % 60_000 !== 0 || b < 60_000 || b > 365 * 86_400_000)) return 'Each warning time must be whole minutes between one minute and 365 days before the expiry';
  if (new Set(s.warnBeforeMs).size !== s.warnBeforeMs.length) return 'Each warning time only once';
  for (const key of ['enabled', 'notifyExpired', 'privateMessage', 'offlineMessage', 'poke'] as const) {
    if (typeof s[key] !== 'boolean') return `${key} must be true or false`;
  }
  for (const key of ['warningText', 'expiredText'] as const) {
    if (typeof s[key] !== 'string' || !s[key].trim() || [...s[key]].length > TEMP_GROUP_TEXT_MAX) return `${key} must be 1 to ${TEMP_GROUP_TEXT_MAX} characters`;
  }
  if (!isValidTimeZone(s.timeZone)) return 'Unknown time zone';
  return null;
}

/**
 * The expiry for a duration from now. Plain milliseconds on purpose: "30 days" is 30 x 24 hours,
 * so a daylight-saving change in between does not move it by an hour.
 */
export function tempGroupExpiry(nowMs: number, durationMs: number): number {
  return nowMs + durationMs;
}

/**
 * Extending: from the current expiry while it still lies ahead, otherwise from now (an entry that
 * is already overdue would otherwise get less than the time asked for).
 */
export function tempGroupExtendedExpiry(currentExpiryMs: number, nowMs: number, durationMs: number): number {
  return Math.max(currentExpiryMs, nowMs) + durationMs;
}

/** null when the duration is allowed, otherwise the reason. */
export function tempGroupDurationProblem(durationMs: unknown): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return 'The duration must be a number of milliseconds';
  if (durationMs < TEMP_GROUP_MIN_DURATION_MS) return 'The deadline must be at least one minute away';
  if (durationMs > TEMP_GROUP_MAX_DURATION_MS) return 'The deadline can be at most five years away';
  return null;
}

/** Pause before the next try after `attempts` failed ones: 30 s, doubling, at most 30 minutes. */
export function tempGroupRetryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * MINUTE_MS);
}
