import type { PrismaClient } from '../generated/prisma/client.js';

const KEY_INTERVAL = 'user_history_interval_seconds';
const KEY_RETENTION = 'user_history_retention_days';

/**
 * How often the user-count history is sampled. A short fixed list rather than
 * a free number: the chart sizes its time buckets from the sampling interval
 * (a bucket narrower than the interval would leave holes in the line), and
 * these are the values that keep that working out to sensible bucket widths.
 */
export const USER_HISTORY_INTERVAL_OPTIONS = [30, 60, 120, 300] as const;

/**
 * Bounds for how many days of history are kept. The floor is a week so the
 * chart's 3- and 7-day windows always have something to show; the ceiling only
 * stops a typo from asking for decades of rows.
 */
export const USER_HISTORY_RETENTION_MIN_DAYS = 7;
export const USER_HISTORY_RETENTION_MAX_DAYS = 365;

/**
 * 60 seconds is fine enough to catch a short visit and cheap enough to keep
 * (about 4 MB a month per virtual server). 32 days is the chart's longest
 * window (31 days) plus one day of lead-in, so the 24-hour average is already
 * correct at the left edge of a month view.
 */
export const USER_HISTORY_DEFAULTS = { intervalSeconds: 60, retentionDays: 32 } as const;

export interface UserHistorySettings {
  intervalSeconds: number;
  retentionDays: number;
}

export function isValidUserHistoryInterval(value: unknown): value is number {
  return typeof value === 'number' && (USER_HISTORY_INTERVAL_OPTIONS as readonly number[]).includes(value);
}

export function isValidUserHistoryRetention(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= USER_HISTORY_RETENTION_MIN_DAYS &&
    value <= USER_HISTORY_RETENTION_MAX_DAYS
  );
}

export async function getUserHistorySettings(prisma: PrismaClient): Promise<UserHistorySettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [KEY_INTERVAL, KEY_RETENTION] } } });
  const stored = new Map(rows.map((r) => [r.key, Number(r.value)]));

  // A stored value that is no longer allowed (an option removed in an update,
  // a hand-edited row) falls back to the default instead of feeding the
  // sampler an interval or retention it was never meant to run with.
  const interval = stored.get(KEY_INTERVAL);
  const retention = stored.get(KEY_RETENTION);
  return {
    intervalSeconds: isValidUserHistoryInterval(interval) ? interval : USER_HISTORY_DEFAULTS.intervalSeconds,
    retentionDays: isValidUserHistoryRetention(retention) ? retention : USER_HISTORY_DEFAULTS.retentionDays,
  };
}

export async function setUserHistorySettings(prisma: PrismaClient, values: UserHistorySettings): Promise<UserHistorySettings> {
  const pairs: Array<[string, string]> = [
    [KEY_INTERVAL, String(values.intervalSeconds)],
    [KEY_RETENTION, String(values.retentionDays)],
  ];
  await prisma.$transaction(
    pairs.map(([key, value]) =>
      prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } }),
    ),
  );
  return values;
}
