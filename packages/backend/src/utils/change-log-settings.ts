import type { PrismaClient } from '../generated/prisma/client.js';

const KEY_ENABLED = 'change_log_enabled';
const KEY_RETENTION = 'change_log_retention_days';
const KEY_MAX_ROWS = 'change_log_max_rows';
const KEY_RECORD_IP = 'change_log_record_ip';
const KEY_WRITE_TS_LOG = 'change_log_write_ts_log';

/**
 * Bounds for how long the change log is kept. It can store the address a change
 * came from, so the span is the admin's call - the same reasoning (and the same
 * numbers) as the connection journal (see connection-journal-settings.ts). The
 * row cap protects the database from a burst of changes regardless of the days.
 */
export const CHANGE_LOG_RETENTION_MIN_DAYS = 1;
export const CHANGE_LOG_RETENTION_MAX_DAYS = 365;
export const CHANGE_LOG_MAX_ROWS_MIN = 1_000;
export const CHANGE_LOG_MAX_ROWS_MAX = 1_000_000;

/** Thirty days and 100 000 rows: enough to follow who changed what, little enough for a small installation. */
export const CHANGE_LOG_DEFAULTS = {
  enabled: true,
  retentionDays: 30,
  maxRows: 100_000,
  // The address is useful next to a change but is personal data, so it can be turned off.
  recordIp: true,
  // A second copy in the TeamSpeak server log is off unless an admin wants it: it costs one
  // extra WebQuery call per server-bound change, which counts against TeamSpeak's flood limits.
  writeToTsLog: false,
} as const;

export interface ChangeLogSettings {
  enabled: boolean;
  retentionDays: number;
  maxRows: number;
  recordIp: boolean;
  writeToTsLog: boolean;
}

export function isValidChangeLogRetention(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= CHANGE_LOG_RETENTION_MIN_DAYS &&
    value <= CHANGE_LOG_RETENTION_MAX_DAYS
  );
}

export function isValidChangeLogMaxRows(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= CHANGE_LOG_MAX_ROWS_MIN &&
    value <= CHANGE_LOG_MAX_ROWS_MAX
  );
}

// The middleware reads these on every change; a short cache keeps that read off nearly all of
// them. Saving clears it, so a switch applies at once.
const CACHE_MS = 5_000;
let cached: { at: number; value: ChangeLogSettings } | null = null;

export async function getChangeLogSettings(prisma: PrismaClient): Promise<ChangeLogSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await readChangeLogSettings(prisma);
  cached = { at: Date.now(), value };
  return value;
}

async function readChangeLogSettings(prisma: PrismaClient): Promise<ChangeLogSettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [KEY_ENABLED, KEY_RETENTION, KEY_MAX_ROWS, KEY_RECORD_IP, KEY_WRITE_TS_LOG] } },
  });
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const flag = (key: string, fallback: boolean) => (stored.has(key) ? stored.get(key) === 'true' : fallback);

  // A stored value that is no longer allowed (a bound that moved, a hand-edited
  // row) falls back to the default rather than feeding the pruner something it
  // was never meant to run with.
  const retention = Number(stored.get(KEY_RETENTION));
  const maxRows = Number(stored.get(KEY_MAX_ROWS));
  return {
    enabled: flag(KEY_ENABLED, CHANGE_LOG_DEFAULTS.enabled),
    retentionDays: isValidChangeLogRetention(retention) ? retention : CHANGE_LOG_DEFAULTS.retentionDays,
    maxRows: isValidChangeLogMaxRows(maxRows) ? maxRows : CHANGE_LOG_DEFAULTS.maxRows,
    recordIp: flag(KEY_RECORD_IP, CHANGE_LOG_DEFAULTS.recordIp),
    writeToTsLog: flag(KEY_WRITE_TS_LOG, CHANGE_LOG_DEFAULTS.writeToTsLog),
  };
}

export async function setChangeLogSettings(prisma: PrismaClient, values: ChangeLogSettings): Promise<ChangeLogSettings> {
  const pairs: Array<[string, string]> = [
    [KEY_ENABLED, String(values.enabled)],
    [KEY_RETENTION, String(values.retentionDays)],
    [KEY_MAX_ROWS, String(values.maxRows)],
    [KEY_RECORD_IP, String(values.recordIp)],
    [KEY_WRITE_TS_LOG, String(values.writeToTsLog)],
  ];
  await prisma.$transaction(
    pairs.map(([key, value]) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })),
  );
  cached = null;
  return values;
}
