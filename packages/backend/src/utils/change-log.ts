import type {
  UiChangeDiff,
  UiChangeLogEntry,
  UiChangeLogPage,
  UiChangeMethod,
  UiChangeRange,
  UiChangeStatus,
} from '@ts6/common';
import { UI_CHANGE_SECRET_PLACEHOLDER, isSecretKey } from '@ts6/common';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../middleware/error-handler.js';
import { getChangeLogSettings } from './change-log-settings.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/** The whole masked body is capped so one request can never bloat a row. */
const BODY_MAX_LENGTH = 4000;
/** A single string value longer than this is dropped (a base64 avatar, an identity blob): its length is kept, not its content. */
const VALUE_MAX_LENGTH = 512;

// --- Masking ------------------------------------------------------------------
// The TeamSpeak parameter names come from the shared list (isSecretKey); the
// interface's own body fields are named differently, so the suffix test and the
// short extra list below cover sshPassword, newPassword, clientSecret, botApiKey
// and the rest. A value is never stored, only the fact that the field changed.

/** Body fields that are secret but whose name ends in none of the suffixes below (`code` is the 2FA code of /api/auth/totp). */
const APP_SECRET_FIELDS: ReadonlySet<string> = new Set(['identitydata', 'cookiefile', 'cookies', 'cookiecontent', 'code']);

export function isSecretField(key: string): boolean {
  const k = key.toLowerCase();
  if (isSecretKey(k) || APP_SECRET_FIELDS.has(k)) return true;
  // `channel_flag_password` is a 0/1 flag, not a secret - keep it readable (same carve-out as classification.ts).
  return /(?:password|secret|apikey|privatekey|token)$/.test(k) && k !== 'channel_flag_password';
}

function maskDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > VALUE_MAX_LENGTH) return `(omitted, ${value.length} chars)`;
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) =>
      [key, isSecretField(key) && v !== '' && v != null ? UI_CHANGE_SECRET_PLACEHOLDER : maskDeep(v)]),
  );
}

/** The request body as a masked JSON string, or null when there was nothing to store. */
export function maskChangeBody(body: unknown): string | null {
  if (body === null || body === undefined) return null;
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) return null;
  const json = JSON.stringify(maskDeep(body));
  if (json === undefined) return null;
  return json.length > BODY_MAX_LENGTH ? `${json.slice(0, BODY_MAX_LENGTH - 1)}…` : json;
}

// --- Writing ------------------------------------------------------------------

/** Everything known about a change before it runs. `body` is already masked. */
export interface ChangeBase {
  /** When the request came in - not when its row happens to be written. */
  createdAt: Date;
  userId: number | null;
  username: string;
  role: string;
  ip: string | null;
  method: UiChangeMethod;
  area: string;
  routePattern: string;
  serverConfigId: number | null;
  virtualServerId: number | null;
  targetId: string | null;
  body: string | null;
}

export interface ChangeOutcome {
  status: Exclude<UiChangeStatus, 'pending'>;
  httpStatus: number;
  errorMessage: string | null;
  durationMs: number;
  loggedToTeamSpeak: boolean;
  /** Before and after as JSON (UiChangeDiff), for a successful change to a target that is read first. */
  changes: string | null;
}

/**
 * Writes the row *before* a security-critical change runs. If it cannot be
 * written the change is refused (AppError), the same stance the query console
 * takes: a trail with silent holes is worse than a change that waits for the
 * database. finishChange then fills in how it ended.
 */
export async function startChange(prisma: PrismaClient, base: ChangeBase): Promise<number> {
  try {
    const row = await prisma.uiChangeLog.create({ data: { ...base, status: 'pending' }, select: { id: true } });
    return row.id;
  } catch (err: any) {
    console.error(`[ChangeLog] Could not write the change log: ${err.message}`);
    throw new AppError(500, 'The change log could not be written, so the change was not made');
  }
}

export async function finishChange(prisma: PrismaClient, id: number, outcome: ChangeOutcome): Promise<void> {
  try {
    await prisma.uiChangeLog.update({ where: { id }, data: outcome });
  } catch (err: any) {
    // The change already ran; the row stays "pending", which is the honest state.
    console.error(`[ChangeLog] Could not complete change row ${id}: ${err.message}`);
  }
}

// The non-critical rows are collected for a moment and written with one createMany: one insert
// per change costs the main thread far more under a burst of writes than one batch does (measured
// with /api/health under parallel writes), and that thread also feeds the music bots. Whoever
// reads the log flushes first, and so does the shutdown.
const FLUSH_AFTER_MS = 1000;
const FLUSH_AT_ROWS = 200;
const buffered: Array<ChangeBase & ChangeOutcome> = [];
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Records a finished change (the non-critical path). A batch that cannot be written is only
 * logged: the changes in it are already over.
 * shortcut: rows still in the buffer are lost if the process is killed hard (SIGKILL, power loss) - at most about a second of non-critical changes; write them straight away if that ever matters.
 */
export function recordChange(prisma: PrismaClient, entry: ChangeBase & ChangeOutcome): void {
  buffered.push(entry);
  if (buffered.length >= FLUSH_AT_ROWS) void flushChangeLog(prisma);
  else if (!flushTimer) {
    flushTimer = setTimeout(() => void flushChangeLog(prisma), FLUSH_AFTER_MS);
    flushTimer.unref?.();
  }
}

export async function flushChangeLog(prisma: PrismaClient): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const rows = buffered.splice(0);
  if (rows.length === 0) return;
  try {
    await prisma.uiChangeLog.createMany({ data: rows });
  } catch (err: any) {
    console.error(`[ChangeLog] Could not write ${rows.length} change log entr${rows.length === 1 ? 'y' : 'ies'}: ${err.message}`);
  }
}

// --- Reading ------------------------------------------------------------------

export interface ChangeLogFilters {
  range: UiChangeRange;
  area?: string;
  method?: UiChangeMethod;
  status?: UiChangeStatus;
  serverConfigId?: number;
  /** Part of a user name, the route, or the target id. */
  q?: string;
}

const RANGE_MS: Record<Exclude<UiChangeRange, 'all'>, number> = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };

function buildWhere(filters: ChangeLogFilters): Prisma.UiChangeLogWhereInput {
  const where: Prisma.UiChangeLogWhereInput = {};
  if (filters.range !== 'all') where.createdAt = { gte: new Date(Date.now() - RANGE_MS[filters.range]) };
  if (filters.area) where.area = filters.area;
  if (filters.method) where.method = filters.method;
  if (filters.status) where.status = filters.status;
  if (filters.serverConfigId !== undefined) where.serverConfigId = filters.serverConfigId;
  if (filters.q) {
    where.OR = [
      { username: { contains: filters.q } },
      { routePattern: { contains: filters.q } },
      { targetId: { contains: filters.q } },
    ];
  }
  return where;
}

export async function listChangeLog(
  prisma: PrismaClient,
  filters: ChangeLogFilters,
  page: number,
  pageSize: number,
): Promise<UiChangeLogPage> {
  await flushChangeLog(prisma);
  const where = buildWhere(filters);
  const [total, rows, servers] = await Promise.all([
    prisma.uiChangeLog.count({ where }),
    // By the time of the request: a batched row gets its id later than a critical one written meanwhile.
    prisma.uiChangeLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    // The server name is resolved here, not stored, so the hot path never looks it up; a deleted connection leaves null.
    prisma.tsServerConfig.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(servers.map((s) => [s.id, s.name]));
  const entries: UiChangeLogEntry[] = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    userId: row.userId,
    username: row.username,
    role: row.role,
    ip: row.ip,
    method: row.method as UiChangeMethod,
    area: row.area,
    routePattern: row.routePattern,
    serverConfigId: row.serverConfigId,
    serverName: row.serverConfigId !== null ? names.get(row.serverConfigId) ?? null : null,
    virtualServerId: row.virtualServerId,
    targetId: row.targetId,
    body: row.body,
    changes: parseDiff(row.changes),
    status: row.status as UiChangeStatus,
    httpStatus: row.httpStatus,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    loggedToTeamSpeak: row.loggedToTeamSpeak,
  }));
  return { entries, total, page, pageSize };
}

function parseDiff(json: string | null): UiChangeDiff | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as UiChangeDiff;
  } catch {
    return null;
  }
}

/** The areas that occur in the log, most entries first - what the area filter offers. */
export async function listChangeAreas(prisma: PrismaClient): Promise<string[]> {
  await flushChangeLog(prisma);
  const groups = await prisma.uiChangeLog.groupBy({ by: ['area'], _count: { id: true } });
  return groups
    .sort((a, b) => b._count.id - a._count.id || a.area.localeCompare(b.area))
    .map((g) => g.area);
}

export async function changeLogStats(prisma: PrismaClient): Promise<{ entryCount: number; oldestAt: string | null }> {
  await flushChangeLog(prisma);
  const [entryCount, oldest] = await Promise.all([
    prisma.uiChangeLog.count(),
    prisma.uiChangeLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  return { entryCount, oldestAt: oldest ? oldest.createdAt.toISOString() : null };
}

export async function clearChangeLog(prisma: PrismaClient): Promise<number> {
  await flushChangeLog(prisma);
  const { count } = await prisma.uiChangeLog.deleteMany({});
  return count;
}

// --- Retention ----------------------------------------------------------------

/** Deletes what is older than the retention setting, then the oldest rows beyond the row cap. */
export async function pruneChangeLog(prisma: PrismaClient): Promise<number> {
  await flushChangeLog(prisma);
  const settings = await getChangeLogSettings(prisma);
  let removed = 0;

  const cutoff = new Date(Date.now() - settings.retentionDays * DAY_MS);
  removed += (await prisma.uiChangeLog.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;

  const boundary = await prisma.uiChangeLog.findFirst({ orderBy: { id: 'desc' }, skip: settings.maxRows - 1, select: { id: true } });
  if (boundary) removed += (await prisma.uiChangeLog.deleteMany({ where: { id: { lt: boundary.id } } })).count;

  if (removed > 0) console.log(`[ChangeLog] Pruned ${removed} entr${removed === 1 ? 'y' : 'ies'}`);
  return removed;
}

/** Prunes once now and then every hour, for as long as the process runs. */
export function startChangeLogPruner(prisma: PrismaClient): void {
  const run = () => pruneChangeLog(prisma).catch((err) => console.warn(`[ChangeLog] Pruning failed: ${err.message}`));
  void run();
  setInterval(run, PRUNE_INTERVAL_MS).unref?.();
}
