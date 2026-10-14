import type { PrismaClient } from '../generated/prisma/client.js';

const KEY_RETENTION = 'bot_log_retention_days';
const KEY_MAX_ROWS = 'bot_log_max_rows';

/**
 * Bounds for how long the bot-flow execution history is kept. Every flow run
 * writes one BotExecution row and a handful of BotExecutionLog rows; a flow on
 * a busy event trigger (a client joining, say) can write thousands a day, and
 * nothing deleted them before. A day is the shortest that still shows the last
 * night's runs, a year the longest that makes sense for debug logs. The row cap
 * protects the database from a burst regardless of the days, and is applied to
 * the execution table and the (much larger) log table alike.
 */
export const BOT_LOG_RETENTION_MIN_DAYS = 1;
export const BOT_LOG_RETENTION_MAX_DAYS = 365;
export const BOT_LOG_MAX_ROWS_MIN = 1_000;
export const BOT_LOG_MAX_ROWS_MAX = 1_000_000;

/** Thirty days and 50 000 rows per table: enough to debug a flow, little enough for a small installation. */
export const BOT_LOG_DEFAULTS = {
  retentionDays: 30,
  maxRows: 50_000,
} as const;

export interface BotLogSettings {
  retentionDays: number;
  maxRows: number;
}

export function isValidBotLogRetention(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= BOT_LOG_RETENTION_MIN_DAYS &&
    value <= BOT_LOG_RETENTION_MAX_DAYS
  );
}

export function isValidBotLogMaxRows(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= BOT_LOG_MAX_ROWS_MIN &&
    value <= BOT_LOG_MAX_ROWS_MAX
  );
}

export async function getBotLogSettings(prisma: PrismaClient): Promise<BotLogSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [KEY_RETENTION, KEY_MAX_ROWS] } } });
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  // A stored value that is no longer allowed (a bound that moved in an update,
  // a hand-edited row) falls back to the default instead of running the pruner
  // with something it was never meant to run with.
  const retention = Number(stored.get(KEY_RETENTION));
  const maxRows = Number(stored.get(KEY_MAX_ROWS));
  return {
    retentionDays: isValidBotLogRetention(retention) ? retention : BOT_LOG_DEFAULTS.retentionDays,
    maxRows: isValidBotLogMaxRows(maxRows) ? maxRows : BOT_LOG_DEFAULTS.maxRows,
  };
}

export async function setBotLogSettings(prisma: PrismaClient, values: BotLogSettings): Promise<BotLogSettings> {
  const pairs: Array<[string, string]> = [
    [KEY_RETENTION, String(values.retentionDays)],
    [KEY_MAX_ROWS, String(values.maxRows)],
  ];
  await prisma.$transaction(
    pairs.map(([key, value]) =>
      prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } }),
    ),
  );
  return values;
}
