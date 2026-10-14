import type { PrismaClient } from '../generated/prisma/client.js';
import { getBotLogSettings } from './bot-log-settings.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1_000; // hourly, like the connection journal

/**
 * Deletes bot-flow executions and their logs older than the retention setting,
 * then the oldest rows beyond the per-table cap. Deleting a BotExecution
 * cascades to its logs (see the schema); logs with no execution are pruned by
 * their own timestamp.
 */
export async function pruneBotLogs(prisma: PrismaClient): Promise<number> {
  const { retentionDays, maxRows } = await getBotLogSettings(prisma);
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
  let removed = 0;

  // By age: executions first (cascades their logs), then any logs left behind
  // (executionId null, or already-detached) by their own timestamp.
  removed += (await prisma.botExecution.deleteMany({ where: { startedAt: { lt: cutoff } } })).count;
  removed += (await prisma.botExecutionLog.deleteMany({ where: { timestamp: { lt: cutoff } } })).count;

  // By row cap: ids only ever grow, so "the newest maxRows rows" is
  // "everything from the maxRows-th highest id up". Cap the executions
  // (cascading their logs) and then the logs that remain.
  const execBoundary = await prisma.botExecution.findFirst({
    orderBy: { id: 'desc' }, skip: maxRows - 1, select: { id: true },
  });
  if (execBoundary) {
    removed += (await prisma.botExecution.deleteMany({ where: { id: { lt: execBoundary.id } } })).count;
  }
  const logBoundary = await prisma.botExecutionLog.findFirst({
    orderBy: { id: 'desc' }, skip: maxRows - 1, select: { id: true },
  });
  if (logBoundary) {
    removed += (await prisma.botExecutionLog.deleteMany({ where: { id: { lt: logBoundary.id } } })).count;
  }

  if (removed > 0) console.log(`[BotLogs] Pruned ${removed} execution/log row(s)`);
  return removed;
}

/** Row counts for the settings panel. */
export async function botLogStats(prisma: PrismaClient): Promise<{ executionCount: number; logCount: number }> {
  const [executionCount, logCount] = await Promise.all([
    prisma.botExecution.count(),
    prisma.botExecutionLog.count(),
  ]);
  return { executionCount, logCount };
}

/** Prunes once now and then every hour, for as long as the process runs. */
export function startBotLogPruner(prisma: PrismaClient): void {
  const run = () => pruneBotLogs(prisma).catch((err) => console.warn(`[BotLogs] Pruning failed: ${err.message}`));
  void run();
  setInterval(run, PRUNE_INTERVAL_MS).unref?.();
}
