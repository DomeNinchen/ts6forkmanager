/**
 * Turns the raw ServerUserSample rows of one virtual server into what the
 * Statistics -> History chart draws. Pure functions, no database and no clock
 * of their own (the caller passes `now`), so the maths can be exercised
 * without a server.
 */

/**
 * The selectable windows, all ending "now". The bucket width is chosen so
 * every window comes out at roughly 700 points - about what a chart can show
 * legibly - which means a month is drawn at one point per hour, a day at one
 * per two minutes. Every width divides 24 hours evenly, which the 24-hour
 * average relies on.
 */
export const USER_HISTORY_RANGES = {
  '24h': { seconds: 24 * 3600, bucketSeconds: 120 },
  '3d': { seconds: 3 * 86_400, bucketSeconds: 360 },
  '7d': { seconds: 7 * 86_400, bucketSeconds: 900 },
  '14d': { seconds: 14 * 86_400, bucketSeconds: 1_800 },
  '31d': { seconds: 31 * 86_400, bucketSeconds: 3_600 },
} as const;

export type UserHistoryRange = keyof typeof USER_HISTORY_RANGES;

export function isUserHistoryRange(value: unknown): value is UserHistoryRange {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(USER_HISTORY_RANGES, value);
}

export const DAY_MS = 86_400_000;

/**
 * A stretch between two rows counts as a gap once it is longer than this many
 * sampling intervals. More than one, because a sampler tick that merely runs a
 * few seconds late (a slow WebQuery answer, a busy event loop) is not an
 * outage; fewer than three, so a real gap is not smoothed over.
 */
export const GAP_FACTOR = 2.5;

export type UserSampleState = 'online' | 'stopped' | 'unreachable';

export interface UserSampleRow {
  /** When the sample was taken, unix milliseconds. */
  t: number;
  state: UserSampleState;
  /** The real-user count; null unless state is "online". */
  users: number | null;
  /** The slot limit when the row was written; null when unknown (older rows, or not online). */
  maxClients: number | null;
  /** The sampling interval in force when the row was written, in seconds. */
  intervalSec: number;
}

/** What the chart marks besides the line itself. */
export type UserHistoryEventKind = 'unreachable' | 'stopped' | 'nodata';

export interface UserHistoryEvent {
  kind: UserHistoryEventKind;
  /** Unix milliseconds, clipped to the requested window. */
  from: number;
  to: number;
}

/** One bucket of the requested window. Every bucket is present, empty ones with nulls. */
export interface UserHistoryPoint {
  /** Bucket start, unix milliseconds. */
  t: number;
  /** Mean user count of the online samples in the bucket, or null when it holds none. */
  avg: number | null;
  /** Highest / lowest single sample in the bucket. */
  max: number | null;
  min: number | null;
  /**
   * Mean of every online sample in the 24 hours up to the end of this bucket.
   * Null wherever `avg` is null, so the line breaks in exactly the same
   * places instead of carrying on through an outage as if nothing happened.
   */
  avg24h: number | null;
  /**
   * The slot limit in force at the end of the bucket (the last online sample
   * that reported one), or null when the bucket is empty or its rows predate
   * the stored limit - the chart draws no limit line there rather than
   * assuming today's value applied.
   */
  slots: number | null;
}

export interface UserHistoryStats {
  /** Users in the newest sample, when it is fresh and the server was online; otherwise null. */
  current: number | null;
  /** The state of the newest sample, or "nodata" when it is too old to say anything about now. */
  currentState: UserSampleState | 'nodata' | null;
  /**
   * Highest single sample in the window and when it was taken, with the slot
   * limit that applied at that moment (null when unknown) so the figure can be
   * read as "13 of 32 slots".
   */
  peak: { users: number; at: number; slots: number | null } | null;
  /** Mean user count over the window's online samples. */
  average: number | null;
  /**
   * Share of measured time the virtual server was online, in percent: online
   * over online + stopped + unreachable, weighted by each row's interval.
   * Time nobody measured (the backend was not running) is not held against it.
   */
  availability: number | null;
  /** When the newest sample of any state was taken. */
  lastSampleAt: number | null;
}

export interface UserHistorySeries {
  from: number;
  to: number;
  bucketSeconds: number;
  points: UserHistoryPoint[];
  events: UserHistoryEvent[];
  stats: UserHistoryStats;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * @param rows  All rows of one virtual server from (window start - 24h) to
 *              now, oldest first. The extra day before the window is what
 *              lets the 24-hour average be right at the window's left edge.
 * @param range The requested window.
 * @param now   The end of the window, unix milliseconds.
 */
export function buildUserHistory(rows: UserSampleRow[], range: UserHistoryRange, now: number): UserHistorySeries {
  const spec = USER_HISTORY_RANGES[range];
  const to = now;
  const from = now - spec.seconds * 1000;

  // A bucket must be at least one sampling interval wide: with a 5 minute
  // interval, 2 minute buckets would be empty two times out of three and the
  // line would fall to pieces for no real reason. Only ever matters for the
  // shortest windows, since the wider ones are wider than any interval.
  let widestIntervalSec = 0;
  for (const r of rows) {
    if (r.t >= from && r.intervalSec > widestIntervalSec) widestIntervalSec = r.intervalSec;
  }
  const bucketSeconds = Math.max(spec.bucketSeconds, Math.ceil(widestIntervalSec / 60) * 60);
  const bucketMs = bucketSeconds * 1000;

  // Buckets are aligned to the unix epoch rather than to the window start, so
  // a refresh a minute later draws the same buckets instead of shifting all of
  // them slightly.
  const gridStart = Math.floor(from / bucketMs) * bucketMs;
  const bucketCount = Math.ceil((to - gridStart) / bucketMs);
  const leadBuckets = Math.ceil(DAY_MS / bucketMs);
  const total = leadBuckets + bucketCount;

  const sum = new Array<number>(total).fill(0);
  const count = new Array<number>(total).fill(0);
  const max = new Array<number>(total).fill(-Infinity);
  const min = new Array<number>(total).fill(Infinity);
  const slots = new Array<number | null>(total).fill(null);

  for (const r of rows) {
    if (r.state !== 'online' || r.users === null) continue;
    const index = Math.floor((r.t - gridStart) / bucketMs) + leadBuckets;
    if (index < 0 || index >= total) continue;
    sum[index] += r.users;
    count[index] += 1;
    if (r.users > max[index]) max[index] = r.users;
    if (r.users < min[index]) min[index] = r.users;
    // Rows come oldest first, so the last one with a limit is the one in force at the end of the bucket.
    if (r.maxClients !== null) slots[index] = r.maxClients;
  }

  // Prefix sums make the trailing 24-hour window a subtraction per bucket.
  const prefixSum = new Array<number>(total + 1).fill(0);
  const prefixCount = new Array<number>(total + 1).fill(0);
  for (let i = 0; i < total; i++) {
    prefixSum[i + 1] = prefixSum[i] + sum[i];
    prefixCount[i + 1] = prefixCount[i] + count[i];
  }

  const points: UserHistoryPoint[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const index = leadBuckets + i;
    const t = gridStart + i * bucketMs;
    if (count[index] === 0) {
      points.push({ t, avg: null, max: null, min: null, avg24h: null, slots: null });
      continue;
    }
    // The 24 hours ending with this bucket: this bucket and the
    // (leadBuckets - 1) before it.
    const windowCount = prefixCount[index + 1] - prefixCount[index + 1 - leadBuckets];
    const windowSum = prefixSum[index + 1] - prefixSum[index + 1 - leadBuckets];
    points.push({
      t,
      avg: round2(sum[index] / count[index]),
      max: max[index],
      min: min[index],
      avg24h: windowCount > 0 ? round2(windowSum / windowCount) : null,
      slots: slots[index],
    });
  }

  return {
    from,
    to,
    bucketSeconds,
    points,
    events: buildEvents(rows, from, to),
    stats: buildStats(rows, from, to),
  };
}

/**
 * The stretches of the window that are not simply "online, and counted":
 * a row that says stopped or unreachable covers the time until the next
 * measurement, and a hole between two rows that is much longer than their
 * interval was time nobody measured at all (the backend was not running, or
 * this connection's recording was switched off).
 *
 * Time before the very first row is not reported - a virtual server that has
 * only just started being recorded was not "missing" before that.
 */
export function buildEvents(rows: UserSampleRow[], from: number, to: number): UserHistoryEvent[] {
  const spans: UserHistoryEvent[] = [];
  const push = (kind: UserHistoryEventKind, start: number, end: number, intervalMs: number) => {
    if (end <= start) return;
    const last = spans[spans.length - 1];
    // Touching stretches of the same kind are one event: a server that was
    // down for an hour produces sixty rows, not sixty markers. "Touching"
    // has to allow for the milliseconds by which one tick runs later than the
    // one before - consecutive rows are routinely 2 to 10 ms further apart
    // than the interval, and with no allowance every such row would start an
    // event of its own.
    if (last && last.kind === kind && start <= last.to + Math.max(1000, intervalMs / 10)) {
      last.to = Math.max(last.to, end);
    } else {
      spans.push({ kind, from: start, to: end });
    }
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const intervalMs = row.intervalSec * 1000;
    const nextAt = i + 1 < rows.length ? rows[i + 1].t : to;

    if (row.state !== 'online') push(row.state, row.t, Math.min(row.t + intervalMs, nextAt), intervalMs);
    if (nextAt - row.t > GAP_FACTOR * intervalMs) push('nodata', row.t + intervalMs, nextAt, intervalMs);
  }

  return spans
    .map((e) => ({ kind: e.kind, from: Math.max(e.from, from), to: Math.min(e.to, to) }))
    .filter((e) => e.to > e.from);
}

function buildStats(rows: UserSampleRow[], from: number, to: number): UserHistoryStats {
  let onlineWeight = 0;
  let downWeight = 0;
  let userSum = 0;
  let userCount = 0;
  let peak: UserHistoryStats['peak'] = null;

  for (const r of rows) {
    if (r.t < from) continue;
    if (r.state === 'online' && r.users !== null) {
      onlineWeight += r.intervalSec;
      userSum += r.users;
      userCount += 1;
      // `>` keeps the first time the peak was reached, not the last.
      if (peak === null || r.users > peak.users) peak = { users: r.users, at: r.t, slots: r.maxClients };
    } else {
      downWeight += r.intervalSec;
    }
  }

  const newest = rows.length > 0 ? rows[rows.length - 1] : null;
  const fresh = newest !== null && to - newest.t <= GAP_FACTOR * newest.intervalSec * 1000;

  return {
    current: fresh && newest.state === 'online' ? newest.users : null,
    currentState: newest === null ? null : fresh ? newest.state : 'nodata',
    peak,
    average: userCount > 0 ? round2(userSum / userCount) : null,
    availability:
      onlineWeight + downWeight > 0 ? round2((onlineWeight / (onlineWeight + downWeight)) * 100) : null,
    lastSampleAt: newest?.t ?? null,
  };
}
