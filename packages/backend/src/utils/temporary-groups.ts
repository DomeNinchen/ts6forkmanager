import type { PrismaClient, TemporaryServerGroup } from '../generated/prisma/client.js';
import {
  TEMP_GROUP_NOTES,
  TEMP_GROUP_OPEN_STATES,
  TEMP_GROUP_RETENTION_DEFAULT_DAYS,
  TEMP_GROUP_RETENTION_MAX_DAYS,
  TEMP_GROUP_RETENTION_MIN_DAYS,
  isOpenTempGroupState,
  tempGroupRetryDelayMs,
  type TempGroupState,
  type TempGroupVia,
  type TemporaryGroupEntry,
} from '@ts6/common';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { ConnectionUnavailableError, TSApiError } from '../middleware/error-handler.js';
import { recordChange } from './change-log.js';
import { getChangeLogSettings } from './change-log-settings.js';
import { getNoticeSettings, noticeWanted, parseNoticeRecord, processTempGroupNotices } from './temporary-group-notices.js';

// Temporary server group memberships (R13). TeamSpeak has no expiry for a membership, so the
// deadline lives in TemporaryServerGroup and a job takes the group away once it has passed.

const DAY_MS = 24 * 60 * 60 * 1000;

export function toTempGroupEntry(row: TemporaryServerGroup): TemporaryGroupEntry {
  return {
    id: row.id,
    serverConfigId: row.serverConfigId,
    sid: row.sid,
    sgid: row.sgid,
    cldbid: row.cldbid,
    clientUid: row.clientUid,
    clientNickname: row.clientNickname,
    expiresAt: row.expiresAt.toISOString(),
    grantedAt: row.grantedAt.toISOString(),
    grantedBy: row.grantedBy,
    via: row.via as TempGroupVia,
    wasMember: row.wasMember,
    state: row.state as TempGroupState,
    error: row.error,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    lastNotice: parseNoticeRecord(row.lastNotice),
    pendingNotice: row.pendingNotice as TemporaryGroupEntry['pendingNotice'],
  };
}

/** The rows the job has to work on at `now`; isTempGroupDue is the same rule for one row. */
export function dueTempGroupsWhere(now: Date) {
  return { state: { in: [...TEMP_GROUP_OPEN_STATES] }, nextAttemptAt: { lte: now } };
}

export function isTempGroupDue(row: Pick<TemporaryServerGroup, 'state' | 'nextAttemptAt'>, now: Date): boolean {
  return isOpenTempGroupState(row.state) && row.nextAttemptAt !== null && row.nextAttemptAt <= now;
}

export interface RevokeResult {
  state: Extract<TempGroupState, 'revoked' | 'already-removed' | 'waiting' | 'error'>;
  /** Why it failed, or how it ended when there was nothing to take away. */
  message: string | null;
}

/**
 * What a failed removal means. The codes were measured on TeamSpeak 6.0.0-beta13.1:
 * servergroupdelclient answers 2563 for a client that is not (or no longer) in the group and for a
 * database entry that is gone, 2560 for a group that no longer exists; clientdbinfo answers 512 for a
 * database entry that is gone. Each of those means the membership is already over.
 */
export function classifyRevokeError(err: unknown): RevokeResult {
  const N = TEMP_GROUP_NOTES;
  if (err instanceof ConnectionUnavailableError) return { state: 'waiting', message: N.connectionInactive };
  if (err instanceof TSApiError) {
    if (err.code === -1) return { state: 'waiting', message: `${N.unreachable}: ${err.message}` };
    if (err.code === 2563) return { state: 'already-removed', message: N.notMember };
    if (err.code === 2560) return { state: 'already-removed', message: N.groupGone };
    if (err.code === 512) return { state: 'already-removed', message: N.clientGone };
    if (err.code === 2568) return { state: 'error', message: `${N.noPower}: ${err.failedPermission ?? 'i_group_member_remove_power'}` };
    return { state: 'error', message: `${N.teamspeakError}: ${err.code} ${err.message}` };
  }
  return { state: 'error', message: err instanceof Error ? err.message : String(err) };
}

/** Takes the group away in TeamSpeak - after checking the database entry still belongs to the same identity. */
export async function removeMembership(pool: ConnectionPool, row: TemporaryServerGroup): Promise<RevokeResult> {
  try {
    // The connection that gave the group takes it away; it had the power then. getBotClient falls back
    // to the main connection when the bot identity was removed in between.
    const client = row.via === 'bot' ? pool.getBotClient(row.serverConfigId) : pool.getClient(row.serverConfigId);
    const [info] = await client.execute(row.sid, 'clientdbinfo', { cldbid: row.cldbid });
    if (info?.client_unique_identifier !== row.clientUid) {
      return { state: 'already-removed', message: TEMP_GROUP_NOTES.otherIdentity };
    }
    await client.execute(row.sid, 'servergroupdelclient', { sgid: row.sgid, cldbid: row.cldbid });
    return { state: 'revoked', message: null };
  } catch (err) {
    return classifyRevokeError(err);
  }
}

/** The row's new fields after an attempt: a failure stays open with a growing pause, anything else ends it. */
export function rowAfterAttempt(attemptsBefore: number, result: RevokeResult, now: Date) {
  const attempts = attemptsBefore + 1;
  return result.state === 'waiting' || result.state === 'error'
    ? { state: result.state, error: result.message, attempts, nextAttemptAt: new Date(now.getTime() + tempGroupRetryDelayMs(attempts)) }
    : { state: result.state, error: result.message, attempts, nextAttemptAt: null, endedAt: now };
}

/**
 * Writes the result of one attempt. An open row is only touched while it is still open, so an
 * extension or "make permanent" that came in meanwhile wins.
 * shortcut: a user action that lands between the TeamSpeak call and this write is overwritten in TeamSpeak (the group is already gone); the window is one round trip.
 */
export async function applyRevokeResult(prisma: PrismaClient, row: TemporaryServerGroup, result: RevokeResult, now = new Date()): Promise<TemporaryServerGroup | null> {
  const { count } = await prisma.temporaryServerGroup.updateMany({
    where: { id: row.id, state: { in: [...TEMP_GROUP_OPEN_STATES] } },
    data: rowAfterAttempt(row.attempts, result, now),
  });
  if (count === 0) return null;
  if (result.state !== row.state || result.message !== row.error) {
    console.log(`[TempGroups] #${row.id} sgid ${row.sgid} cldbid ${row.cldbid} on ${row.serverConfigId}/${row.sid}: ${result.state}${result.message ? ` (${result.message})` : ''}`);
  }
  return prisma.temporaryServerGroup.findUnique({ where: { id: row.id } });
}

/** The change-log row for a removal nobody clicked: the job's own, like the scheduled backup's. */
async function logAutomaticRemoval(prisma: PrismaClient, row: TemporaryServerGroup, startedAt: number): Promise<void> {
  try {
    if (!(await getChangeLogSettings(prisma)).enabled) return;
  } catch {
    return;
  }
  recordChange(prisma, {
    createdAt: new Date(startedAt), userId: null, username: 'system', role: 'system', ip: null,
    method: 'DELETE', area: 'temporary-groups', routePattern: '/servers/:configId/vs/:sid/temporary-groups/:id (expired)',
    serverConfigId: row.serverConfigId, virtualServerId: row.sid, targetId: String(row.id),
    body: JSON.stringify({ sgid: row.sgid, cldbid: row.cldbid, client: row.clientNickname, expiresAt: row.expiresAt.toISOString() }),
    status: 'ok', httpStatus: 200, errorMessage: null, durationMs: Date.now() - startedAt, loggedToTeamSpeak: false, changes: null,
  });
}

/** One pass over everything that is due, one row after the other (TeamSpeak counts every command against its flood limit). */
export async function processDueTempGroups(prisma: PrismaClient, pool: ConnectionPool, now = new Date()): Promise<number> {
  const rows = await prisma.temporaryServerGroup.findMany({ where: dueTempGroupsWhere(now), orderBy: { nextAttemptAt: 'asc' }, take: 100 });
  for (const row of rows) {
    const startedAt = Date.now();
    const result = await removeMembership(pool, row);
    const updated = await applyRevokeResult(prisma, row, result);
    if (updated && result.state === 'revoked') {
      await logAutomaticRemoval(prisma, row, startedAt);
      // The notice pass right after this one tells the client (or waits until it is online).
      if (noticeWanted(await getNoticeSettings(prisma, row.serverConfigId, row.sid), 'expired')) {
        await prisma.temporaryServerGroup.update({ where: { id: row.id }, data: { pendingNotice: 'expired' } });
      }
    }
  }
  return rows.length;
}

// --- Retention ----------------------------------------------------------------

const KEY_RETENTION = 'temporary_groups_retention_days';

export function isValidTempGroupRetention(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= TEMP_GROUP_RETENTION_MIN_DAYS && value <= TEMP_GROUP_RETENTION_MAX_DAYS;
}

export async function getTempGroupRetentionDays(prisma: PrismaClient): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY_RETENTION } });
  const value = row ? Number(row.value) : NaN;
  return isValidTempGroupRetention(value) ? value : TEMP_GROUP_RETENTION_DEFAULT_DAYS;
}

export async function setTempGroupRetentionDays(prisma: PrismaClient, days: number): Promise<void> {
  await prisma.appSetting.upsert({ where: { key: KEY_RETENTION }, create: { key: KEY_RETENTION, value: String(days) }, update: { value: String(days) } });
}

/** Removes ended rows older than the retention; open ones are never touched. */
export async function pruneTempGroups(prisma: PrismaClient, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - (await getTempGroupRetentionDays(prisma)) * DAY_MS);
  const { count } = await prisma.temporaryServerGroup.deleteMany({ where: { state: { notIn: [...TEMP_GROUP_OPEN_STATES] }, endedAt: { lt: cutoff } } });
  if (count > 0) console.log(`[TempGroups] Pruned ${count} ended entr${count === 1 ? 'y' : 'ies'}`);
  return count;
}

// --- The job ------------------------------------------------------------------

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Starts the removal job: one pass right away, then every 30 s (TEMP_GROUP_TICK_MS, meant for tests).
 *
 * Unlike a waiting flow Delay (flow-runner.ts MAX_RESUME_LATE_MS, which drops a resume that is too
 * late after a restart), an overdue removal is never dropped: the first pass after a start catches up
 * on everything that expired while the backend was down. Too late is still better than never here.
 */
export function startTemporaryGroupJob(prisma: PrismaClient, pool: ConnectionPool): { stop(): Promise<void> } {
  const tickMs = Number(process.env.TEMP_GROUP_TICK_MS) > 0 ? Number(process.env.TEMP_GROUP_TICK_MS) : 30_000;
  let running: Promise<unknown> | null = null;
  const tick = () => {
    if (running) return;
    running = processDueTempGroups(prisma, pool)
      .then(() => processTempGroupNotices(prisma, pool))
      .catch((err) => console.warn(`[TempGroups] Pass failed: ${err.message}`))
      .finally(() => { running = null; });
  };
  const prune = () => void pruneTempGroups(prisma).catch((err) => console.warn(`[TempGroups] Pruning failed: ${err.message}`));
  tick();
  prune();
  const timer = setInterval(tick, tickMs);
  const pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
  timer.unref?.();
  pruneTimer.unref?.();
  return {
    async stop() {
      clearInterval(timer);
      clearInterval(pruneTimer);
      await running;
    },
  };
}
