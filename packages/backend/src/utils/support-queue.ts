import type { PrismaClient, SupportCase, SupportQueue } from '../generated/prisma/client.js';
import {
  SUPPORT_OPEN_STATES,
  SUPPORT_PAUSE_NOTES,
  SUPPORT_RETENTION_DEFAULT_DAYS,
  SUPPORT_RETENTION_MAX_DAYS,
  SUPPORT_RETENTION_MIN_DAYS,
  SUPPORT_QUEUE_DEFAULTS,
  supportSettingsProblem,
  type SupportCaseEntry,
  type SupportCaseState,
  type SupportEndReason,
  type SupportPerson,
  type SupportQueueConfig,
  type SupportQueueSettings,
  type SupportQueueStatus,
} from '@ts6/common';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import { ConnectionUnavailableError } from '../middleware/error-handler.js';
import { NOTICES_PER_PASS, byQueueOrder, processQueueNotices } from './support-queue-notices.js';

// Support queue (R14). TeamSpeak has no queue, so the manager keeps one per waiting channel: every few
// seconds it reads the client list and moves each case along (reconcile, a pure function), so a restart
// or an outage only needs one look at the real list to be back in step.

const OPEN = [...SUPPORT_OPEN_STATES];

/** A voice client as clientlist -uid -away -groups shows it. */
export interface ListedClient {
  clid: number;
  uid: string;
  cldbid: number;
  nickname: string;
  cid: number;
  groups: number[];
  away: boolean;
}

/** Voice clients only: query clients (client_type 1) are never queued and never supporters. */
export function parseClientList(rows: Array<Record<string, unknown>>): ListedClient[] {
  return rows
    .filter((r) => String(r.client_type) === '0')
    .map((r) => ({
      clid: Number(r.clid),
      uid: String(r.client_unique_identifier ?? ''),
      cldbid: Number(r.client_database_id),
      nickname: String(r.client_nickname ?? ''),
      cid: Number(r.cid),
      groups: String(r.client_servergroups ?? '').split(',').filter(Boolean).map(Number),
      away: String(r.client_away) === '1',
    }))
    .filter((c) => c.uid);
}

export function parseSettings(json: string | null | undefined): SupportQueueSettings {
  let parsed: unknown = null;
  try { parsed = json ? JSON.parse(json) : null; } catch { /* broken JSON = defaults */ }
  const merged = { ...SUPPORT_QUEUE_DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) } as SupportQueueSettings;
  return supportSettingsProblem(merged) ? { ...SUPPORT_QUEUE_DEFAULTS } : merged;
}

export function isSupporter(c: ListedClient, s: SupportQueueSettings): boolean {
  return c.groups.some((g) => s.supporterGroupIds.includes(g));
}

/** A supporter who can take a case: not in an AFK channel and not away (his decision 13). */
export function isAvailableSupporter(c: ListedClient, s: SupportQueueSettings): boolean {
  return isSupporter(c, s) && !s.afkChannelIds.includes(c.cid) && !c.away;
}

export function isVip(c: ListedClient, s: SupportQueueSettings): boolean {
  return c.groups.some((g) => s.vipGroupIds.includes(g));
}

const person = (c: ListedClient): SupportPerson => ({ uid: c.uid, nickname: c.nickname, cldbid: c.cldbid });

// --- Reconcile ------------------------------------------------------------------------------

export interface OpenCase {
  id: number;
  clientUid: string;
  cldbid: number;
  nickname: string;
  state: SupportCaseState;
  absentSince: number | null;
  vip: boolean;
}

export type CaseChange =
  | { kind: 'create'; uid: string; cldbid: number; nickname: string; arrivalUnknown: boolean; vip: boolean }
  | { kind: 'update'; id: number; from: SupportCaseState; data: CaseUpdate };

export interface CaseUpdate {
  state?: SupportCaseState;
  absentSince?: number | null;
  nickname?: string;
  cldbid?: number;
  vip?: boolean;
  takenAt?: number;
  takenBy?: SupportPerson[];
  takenVia?: 'teamspeak';
  endedAt?: number;
  endReason?: SupportEndReason;
}

export interface ReconcileInput {
  channelId: number;
  settings: SupportQueueSettings;
  cases: OpenCase[];
  clients: ListedClient[];
  now: number;
  /** Absences count from here at the earliest: the start of watching (after a restart or an outage). */
  watchingSince: number;
  /** The first look at this queue since watching started: whoever waits now arrived at an unknown time. */
  firstLook: boolean;
}

/**
 * What changes, given the open cases and the client list right now.
 * - Waiting: in the waiting channel = keeps its place; in another channel with a supporter = taken
 *   (his decision 11; a supporter walking into the waiting channel takes nobody); anywhere else or offline
 *   longer than the grace period = cancelled.
 * - Taken: with a supporter (any channel) = goes on; otherwise longer than the grace period = done (12).
 * - New: a non-supporter in the waiting channel without an open case, unless nobody may queue now (5).
 */
export function reconcile(input: ReconcileInput): CaseChange[] {
  const { channelId, settings: s, now } = input;
  const graceMs = s.graceSec * 1000;
  const byUid = new Map<string, ListedClient>();
  for (const c of input.clients) {
    // Two connections of one identity: the one in the waiting channel decides.
    if (!byUid.has(c.uid) || c.cid === channelId) byUid.set(c.uid, c);
  }
  const supportersIn = (cid: number, self: ListedClient) =>
    input.clients.filter((x) => x.clid !== self.clid && x.cid === cid && isSupporter(x, s) && !s.afkChannelIds.includes(x.cid));
  const graceOver = (absentSince: number) => now - Math.max(absentSince, input.watchingSince) >= graceMs;

  const changes: CaseChange[] = [];
  const open = new Set<string>();
  for (const k of input.cases) {
    open.add(k.clientUid);
    const c = byUid.get(k.clientUid);
    const seen: CaseUpdate = c && (c.nickname !== k.nickname || c.cldbid !== k.cldbid) ? { nickname: c.nickname, cldbid: c.cldbid } : {};
    // A VIP group given or taken while waiting moves the case at once; once taken the flag stays as it was.
    if (c && k.state === 'waiting' && isVip(c, s) !== k.vip) seen.vip = !k.vip;
    const present = (): CaseUpdate | null => (k.absentSince !== null ? { ...seen, absentSince: null } : Object.keys(seen).length ? seen : null);
    const absent = (reason: SupportEndReason, end: SupportCaseState): CaseUpdate | null => {
      if (k.absentSince === null) return { ...seen, absentSince: now };
      if (graceOver(k.absentSince)) return { ...seen, state: end, endedAt: now, endReason: reason };
      return Object.keys(seen).length ? seen : null;
    };
    let data: CaseUpdate | null;
    if (k.state === 'waiting') {
      const with_ = c && c.cid !== channelId ? supportersIn(c.cid, c) : [];
      if (c && c.cid === channelId) data = present();
      else if (with_.length) data = { ...seen, state: 'in-progress', absentSince: null, takenAt: now, takenBy: with_.map(person), takenVia: 'teamspeak' };
      else data = absent(c ? 'left-channel' : 'left-server', 'cancelled');
    } else {
      data = c && supportersIn(c.cid, c).length ? present() : absent(c ? 'finished' : 'left-server', 'done');
    }
    if (data) changes.push({ kind: 'update', id: k.id, from: k.state, data });
  }

  const mayQueue = s.queueWithoutSupporter || input.clients.some((c) => isAvailableSupporter(c, s));
  if (mayQueue) {
    for (const c of byUid.values()) {
      if (c.cid !== channelId || open.has(c.uid) || isSupporter(c, s)) continue;
      changes.push({ kind: 'create', uid: c.uid, cldbid: c.cldbid, nickname: c.nickname, arrivalUnknown: input.firstLook, vip: isVip(c, s) });
    }
  }
  return changes;
}

// --- Rows -----------------------------------------------------------------------------------

function parsePeople(json: string | null): SupportPerson[] {
  try {
    const v = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function toCaseEntry(row: SupportCase, position: number | null = null): SupportCaseEntry {
  return {
    id: row.id,
    queueId: row.queueId,
    clientUid: row.clientUid,
    cldbid: row.cldbid,
    nickname: row.nickname,
    arrivedAt: row.arrivedAt.toISOString(),
    arrivalUnknown: row.arrivalUnknown,
    state: row.state as SupportCaseState,
    position,
    absentSince: row.absentSince?.toISOString() ?? null,
    takenAt: row.takenAt?.toISOString() ?? null,
    takenBy: parsePeople(row.takenBy),
    takenVia: row.takenVia as SupportCaseEntry['takenVia'],
    actedBy: row.actedBy,
    roomCid: row.roomCid,
    vip: row.vip,
    endedAt: row.endedAt?.toISOString() ?? null,
    endReason: row.endReason as SupportEndReason | null,
  };
}

/** Open cases as the page lists them: the waiting ones in their order (VIPs first, then arrival), then the taken ones. */
export function orderOpenCases(rows: SupportCase[]): SupportCaseEntry[] {
  const waiting = rows.filter((r) => r.state === 'waiting').sort(byQueueOrder);
  const taken = rows.filter((r) => r.state === 'in-progress').sort(byQueueOrder);
  return [...waiting.map((r, i) => toCaseEntry(r, i + 1)), ...taken.map((r) => toCaseEntry(r))];
}

export function toQueueConfig(row: SupportQueue | null): SupportQueueConfig {
  return row
    ? { id: row.id, enabled: row.enabled, channelId: row.channelId, settings: parseSettings(row.settings) }
    : { id: null, enabled: false, channelId: 0, settings: { ...SUPPORT_QUEUE_DEFAULTS } };
}

function updateData(d: CaseUpdate) {
  const date = (n: number | null | undefined) => (n === undefined ? undefined : n === null ? null : new Date(n));
  return {
    state: d.state,
    absentSince: date(d.absentSince),
    nickname: d.nickname,
    cldbid: d.cldbid,
    vip: d.vip,
    takenAt: date(d.takenAt),
    takenBy: d.takenBy ? JSON.stringify(d.takenBy) : undefined,
    takenVia: d.takenVia,
    endedAt: date(d.endedAt),
    endReason: d.endReason,
  };
}

/**
 * Writes the changes. Each update only lands while the case is still in the state it was read in,
 * so a take-over or removal from the web UI that came in meanwhile wins.
 */
export async function applyChanges(prisma: PrismaClient, queueId: number, changes: CaseChange[], now: number): Promise<void> {
  for (const ch of changes) {
    if (ch.kind === 'create') {
      // Only the job creates cases and it runs one pass at a time, so no second open case can appear in between.
      await prisma.supportCase.create({
        data: { queueId, clientUid: ch.uid, cldbid: ch.cldbid, nickname: ch.nickname, arrivedAt: new Date(now), arrivalUnknown: ch.arrivalUnknown, vip: ch.vip },
      });
    } else {
      await prisma.supportCase.updateMany({ where: { id: ch.id, state: ch.from }, data: updateData(ch.data) });
    }
  }
}

/** Ends every open case of a queue (switched off, or the waiting channel changed). */
export async function closeOpenCases(prisma: PrismaClient, queueId: number, now = new Date()): Promise<number> {
  const { count: c1 } = await prisma.supportCase.updateMany({ where: { queueId, state: 'waiting' }, data: { state: 'cancelled', endedAt: now, endReason: 'queue-changed' } });
  const { count: c2 } = await prisma.supportCase.updateMany({ where: { queueId, state: 'in-progress' }, data: { state: 'done', endedAt: now, endReason: 'queue-changed' } });
  return c1 + c2;
}

// --- Live state per queue (not stored: a restart starts watching anew) -----------------------

interface LiveState {
  paused: string | null;
  pausedSince: number | null;
  checkedAt: number | null;
  /** Start of the current stretch of successful looks; null before the first one. */
  watchingSince: number | null;
  supporters: SupportQueueStatus['supporters'];
}

const live = new Map<number, LiveState>();

function liveOf(queueId: number): LiveState {
  let st = live.get(queueId);
  if (!st) live.set(queueId, (st = { paused: null, pausedSince: null, checkedAt: null, watchingSince: null, supporters: [] }));
  return st;
}

export function getQueueStatus(queueId: number | null): SupportQueueStatus {
  const st = queueId === null ? undefined : live.get(queueId);
  return {
    paused: st?.paused ?? null,
    pausedSince: st?.pausedSince ? new Date(st.pausedSince).toISOString() : null,
    checkedAt: st?.checkedAt ? new Date(st.checkedAt).toISOString() : null,
    supporters: st?.supporters ?? [],
  };
}

/** Forget what was seen, so the next look counts as the first (after switching on or another channel). */
export function resetQueueState(queueId: number): void {
  live.delete(queueId);
}

// --- The job --------------------------------------------------------------------------------

/**
 * One pass: one clientlist per virtual server with an enabled queue, then each queue reconciled.
 * A failed clientlist changes no case at all: the queue pauses, and the next good look counts
 * absences from then on, so an outage never turns everyone into "cancelled".
 */
export async function processSupportQueues(prisma: PrismaClient, pool: ConnectionPool, now = Date.now()): Promise<void> {
  const queues = await prisma.supportQueue.findMany({ where: { enabled: true } });
  const groups = new Map<string, SupportQueue[]>();
  for (const q of queues) {
    const key = `${q.serverConfigId}:${q.sid}`;
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  for (const qs of groups.values()) {
    const { serverConfigId, sid } = qs[0];
    let clients: ListedClient[];
    try {
      const rows = await pool.getClient(serverConfigId).execute(sid, 'clientlist', { '-uid': '', '-away': '', '-groups': '' });
      clients = parseClientList(rows as Array<Record<string, unknown>>);
    } catch (err) {
      const reason = err instanceof ConnectionUnavailableError
        ? SUPPORT_PAUSE_NOTES.connectionInactive
        : `${SUPPORT_PAUSE_NOTES.unreachable}: ${err instanceof Error ? err.message : String(err)}`;
      for (const q of qs) {
        const st = liveOf(q.id);
        if (st.paused === null) console.warn(`[SupportQueue] Queue #${q.id} on ${serverConfigId}/${sid} paused: ${reason}`);
        if (st.paused === null) st.pausedSince = now;
        st.paused = reason;
        st.watchingSince = null;
        st.supporters = [];
      }
      continue;
    }
    // One budget per virtual server and pass for messages and pokes (TeamSpeak's flood protection).
    const budget = { left: NOTICES_PER_PASS };
    for (const q of qs) {
      const st = liveOf(q.id);
      const firstLook = st.watchingSince === null;
      if (st.paused !== null) console.log(`[SupportQueue] Queue #${q.id} on ${serverConfigId}/${sid} resumed`);
      if (firstLook) st.watchingSince = now;
      st.paused = null;
      st.pausedSince = null;
      st.checkedAt = now;
      const settings = parseSettings(q.settings);
      st.supporters = clients.filter((c) => isAvailableSupporter(c, settings)).map((c) => ({ ...person(c), clid: c.clid, cid: c.cid }));
      const rows = await prisma.supportCase.findMany({ where: { queueId: q.id, state: { in: OPEN } } });
      const changes = reconcile({
        channelId: q.channelId,
        settings,
        cases: rows.map((r) => ({ id: r.id, clientUid: r.clientUid, cldbid: r.cldbid, nickname: r.nickname, state: r.state as SupportCaseState, absentSince: r.absentSince?.getTime() ?? null, vip: r.vip })),
        clients,
        now,
        watchingSince: st.watchingSince!,
        firstLook,
      });
      await applyChanges(prisma, q.id, changes, now);
      const after = await prisma.supportCase.findMany({ where: { queueId: q.id, state: { in: OPEN } } });
      try {
        await processQueueNotices(prisma, pool.getBotClient(serverConfigId), q, settings, after, clients, clients.filter((c) => isAvailableSupporter(c, settings)), budget, now);
      } catch (err: any) {
        console.warn(`[SupportQueue] Notices for queue #${q.id} skipped this pass: ${err.message}`);
      }
    }
  }
}

// --- Retention (his decision 9) -------------------------------------------------------------

const KEY_RETENTION = 'support_queue_retention_days';
const DAY_MS = 86_400_000;

export function isValidSupportRetention(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= SUPPORT_RETENTION_MIN_DAYS && value <= SUPPORT_RETENTION_MAX_DAYS;
}

export async function getSupportRetentionDays(prisma: PrismaClient): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY_RETENTION } });
  const value = row ? Number(row.value) : NaN;
  return isValidSupportRetention(value) ? value : SUPPORT_RETENTION_DEFAULT_DAYS;
}

export async function setSupportRetentionDays(prisma: PrismaClient, days: number): Promise<void> {
  await prisma.appSetting.upsert({ where: { key: KEY_RETENTION }, create: { key: KEY_RETENTION, value: String(days) }, update: { value: String(days) } });
}

/** Removes ended cases older than the retention; open ones are never touched. */
export async function pruneSupportCases(prisma: PrismaClient, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - (await getSupportRetentionDays(prisma)) * DAY_MS);
  const { count } = await prisma.supportCase.deleteMany({ where: { state: { notIn: OPEN }, endedAt: { lt: cutoff } } });
  if (count > 0) console.log(`[SupportQueue] Pruned ${count} ended case${count === 1 ? '' : 's'}`);
  return count;
}

/** Starts the queue job: a pass right away, then every 5 s (SUPPORT_QUEUE_TICK_MS, meant for tests). */
export function startSupportQueueJob(prisma: PrismaClient, pool: ConnectionPool): { stop(): Promise<void> } {
  const tickMs = Number(process.env.SUPPORT_QUEUE_TICK_MS) > 0 ? Number(process.env.SUPPORT_QUEUE_TICK_MS) : 5_000;
  let running: Promise<unknown> | null = null;
  const tick = () => {
    if (running) return;
    running = processSupportQueues(prisma, pool)
      .catch((err) => console.warn(`[SupportQueue] Pass failed: ${err.message}`))
      .finally(() => { running = null; });
  };
  const prune = () => void pruneSupportCases(prisma).catch((err) => console.warn(`[SupportQueue] Pruning failed: ${err.message}`));
  tick();
  prune();
  const timer = setInterval(tick, tickMs);
  const pruneTimer = setInterval(prune, 60 * 60 * 1000);
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
