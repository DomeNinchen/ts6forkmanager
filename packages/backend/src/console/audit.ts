import type { ConsoleAuditEntry, ConsoleAuditPage, ConsoleAuditStatus } from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AppError } from '../middleware/error-handler.js';

export interface AuditStart {
  userId: number | null;
  username: string;
  serverConfigId: number;
  serverName: string;
  virtualServerId: number;
  /** Already masked - nothing secret may reach this file. */
  command: string;
  commandName: string;
  danger: boolean;
  mutating: boolean;
}

export interface AuditFinish {
  status: Exclude<ConsoleAuditStatus, 'pending'>;
  errorCode: number | null;
  errorMessage: string | null;
  durationMs: number;
  loggedToTeamSpeak: boolean;
}

/**
 * Writes the row *before* the command is sent. If it can not be written the
 * command does not run: an audit trail that quietly has holes is worse than a
 * console that refuses to work while the database is unavailable.
 */
export async function startAudit(prisma: PrismaClient, entry: AuditStart): Promise<number> {
  try {
    const row = await prisma.queryConsoleLog.create({ data: { ...entry, status: 'pending' }, select: { id: true } });
    return row.id;
  } catch (err: any) {
    console.error(`[Console] Could not write the audit trail: ${err.message}`);
    throw new AppError(500, 'The audit trail could not be written, so the command was not sent');
  }
}

/** Writes a row for something that is already over, in one go. A row that can not be written is only logged: there is nothing left to hold back. */
export async function recordAudit(prisma: PrismaClient, entry: AuditStart & AuditFinish): Promise<void> {
  try {
    await prisma.queryConsoleLog.create({ data: entry, select: { id: true } });
  } catch (err: any) {
    console.error(`[Console] Could not write the audit trail: ${err.message}`);
  }
}

export async function finishAudit(prisma: PrismaClient, id: number, outcome: AuditFinish): Promise<void> {
  try {
    await prisma.queryConsoleLog.update({ where: { id }, data: outcome });
  } catch (err: any) {
    // The command already ran; the row stays "pending", which is the honest state.
    console.error(`[Console] Could not complete audit row ${id}: ${err.message}`);
  }
}

const PRUNE_INTERVAL_MS = 60 * 60_000;
let lastPruneAt = 0;

/** Drops audit rows older than the retention setting - at most once an hour, when a new row is written. */
export async function pruneAuditIfDue(prisma: PrismaClient, retentionDays: number): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  try {
    const { count } = await prisma.queryConsoleLog.deleteMany({
      where: { createdAt: { lt: new Date(now - retentionDays * 24 * 60 * 60_000) } },
    });
    if (count > 0) console.log(`[Console] Pruned ${count} audit entr${count === 1 ? 'y' : 'ies'} older than ${retentionDays} days`);
  } catch (err: any) {
    console.warn(`[Console] Audit pruning failed: ${err.message}`);
    // Try again on the next write instead of waiting another hour.
    lastPruneAt = 0;
  }
}

export interface AuditQuery {
  limit: number;
  /** Only rows older than this id - keyset paging, stable while new rows keep arriving. */
  before?: number;
  serverConfigId?: number;
  status?: ConsoleAuditStatus;
  dangerOnly?: boolean;
  /** Substring of the command or the user name. */
  search?: string;
}

export async function listAudit(prisma: PrismaClient, query: AuditQuery): Promise<ConsoleAuditPage> {
  const rows = await prisma.queryConsoleLog.findMany({
    where: {
      ...(query.before !== undefined ? { id: { lt: query.before } } : {}),
      ...(query.serverConfigId !== undefined ? { serverConfigId: query.serverConfigId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dangerOnly ? { danger: true } : {}),
      ...(query.search
        ? { OR: [{ command: { contains: query.search } }, { username: { contains: query.search } }] }
        : {}),
    },
    orderBy: { id: 'desc' },
    take: query.limit + 1,
  });

  const page = rows.slice(0, query.limit);
  const items: ConsoleAuditEntry[] = page.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    userId: row.userId,
    username: row.username,
    serverConfigId: row.serverConfigId,
    serverName: row.serverName,
    virtualServerId: row.virtualServerId,
    command: row.command,
    commandName: row.commandName,
    danger: row.danger,
    mutating: row.mutating,
    status: row.status as ConsoleAuditStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    loggedToTeamSpeak: row.loggedToTeamSpeak,
  }));

  return { items, nextBefore: rows.length > query.limit ? page[page.length - 1].id : null };
}
