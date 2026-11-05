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
