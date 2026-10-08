import type { PrismaClient } from '../generated/prisma/client.js';

const KEY_ENABLED = 'connection_journal_enabled';
const KEY_RETENTION = 'connection_journal_retention_days';
const KEY_MAX_ROWS = 'connection_journal_max_rows';

/**
 * Bounds for the connection journal's retention. The journal stores IP
 * addresses, so how long they are kept is the admin's call: a day is the
 * shortest that still shows a night's attempts, a year the longest that makes
 * sense for a tool like this. The row cap protects the database from a flood
 * of attempts regardless of the days.
 */
export const CONNECTION_JOURNAL_RETENTION_MIN_DAYS = 1;
export const CONNECTION_JOURNAL_RETENTION_MAX_DAYS = 365;
export const CONNECTION_JOURNAL_MAX_ROWS_MIN = 1_000;
export const CONNECTION_JOURNAL_MAX_ROWS_MAX = 1_000_000;

/** Thirty days and 100 000 rows: enough to see a pattern, little enough for a small installation. */
export const CONNECTION_JOURNAL_DEFAULTS = { enabled: true, retentionDays: 30, maxRows: 100_000 } as const;

export interface ConnectionJournalSettings {
  enabled: boolean;
  retentionDays: number;
  maxRows: number;
}

export function isValidJournalRetention(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= CONNECTION_JOURNAL_RETENTION_MIN_DAYS &&
    value <= CONNECTION_JOURNAL_RETENTION_MAX_DAYS
  );
}

export function isValidJournalMaxRows(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= CONNECTION_JOURNAL_MAX_ROWS_MIN &&
    value <= CONNECTION_JOURNAL_MAX_ROWS_MAX
  );
}

export async function getConnectionJournalSettings(prisma: PrismaClient): Promise<ConnectionJournalSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [KEY_ENABLED, KEY_RETENTION, KEY_MAX_ROWS] } } });
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  // A stored value that is no longer allowed (a bound that moved in an update,
  // a hand-edited row) falls back to the default instead of running the pruner
  // with something it was never meant to run with.
  const retention = Number(stored.get(KEY_RETENTION));
  const maxRows = Number(stored.get(KEY_MAX_ROWS));
  return {
    enabled: stored.has(KEY_ENABLED) ? stored.get(KEY_ENABLED) === 'true' : CONNECTION_JOURNAL_DEFAULTS.enabled,
    retentionDays: isValidJournalRetention(retention) ? retention : CONNECTION_JOURNAL_DEFAULTS.retentionDays,
    maxRows: isValidJournalMaxRows(maxRows) ? maxRows : CONNECTION_JOURNAL_DEFAULTS.maxRows,
  };
}

export async function setConnectionJournalSettings(
  prisma: PrismaClient,
  values: ConnectionJournalSettings,
): Promise<ConnectionJournalSettings> {
  const pairs: Array<[string, string]> = [
    [KEY_ENABLED, String(values.enabled)],
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
