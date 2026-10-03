/**
 * Turns the rolled-up bandwidth and ping rows of one virtual server into what
 * the Statistics -> History chart draws, the same way user-history-series.ts
 * does for the user count: fixed-size time buckets, a trailing 24-hour average,
 * and the stretches that were unreachable, stopped, or unmeasured. Pure
 * functions, no database and no clock of their own.
 */

import {
  DAY_MS,
  GAP_FACTOR,
  USER_HISTORY_RANGES,
  buildEvents as buildUserEvents,
  type UserHistoryEvent,
  type UserHistoryRange,
  type UserSampleRow,
} from './user-history-series.js';

export type MetricKind = 'bandwidth' | 'ping';

export function isMetricKind(value: unknown): value is MetricKind {
  return value === 'bandwidth' || value === 'ping';
}

/** The user chart's three marks plus the one that only the ping chart has: the ping target did not answer. */
export type MetricEventKind = UserHistoryEvent['kind'] | 'pingtimeout';

export interface MetricEvent {
  kind: MetricEventKind;
  /** Unix milliseconds, clipped to the requested window. */
  from: number;
  to: number;
}

/** One stored rollup row, as the series builder wants it. */
export interface RollupSampleRow {
  /** Start of the window the row covers, unix milliseconds. */
  t: number;
  intervalSec: number;
  bytesIn: number | null;
  bytesOut: number | null;
  spanSec: number | null;
  peakIn: number | null;
  peakOut: number | null;
  pingOk: number;
  pingFailed: number;
  pingAvg: number | null;
  pingMin: number | null;
  pingMax: number | null;
}

/** One time bucket of the bandwidth chart; rates are bytes per second, null where the bucket has nothing to say. */
export interface BandwidthPoint {
  t: number;
  avgIn: number | null;
  avgOut: number | null;
  /** The highest sampled "last second" rate in the bucket - a floor for the real peak. */
  peakIn: number | null;
  peakOut: number | null;
  avg24hIn: number | null;
  avg24hOut: number | null;
}

/** One time bucket of the ping chart, in milliseconds. */
export interface PingPoint {
  t: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  avg24h: number | null;
  /** How many pings in the bucket got no answer. */
  failed: number;
}

export interface Peak {
  value: number;
  at: number;
}

export interface BandwidthStats {
  /** The newest finished window's average rate, when it is recent enough to mean "now". */
  currentIn: number | null;
  currentOut: number | null;
  peakIn: Peak | null;
  peakOut: Peak | null;
  /** Exact average rate over the range, from the byte totals. */
  averageIn: number | null;
  averageOut: number | null;
  /** Bytes moved in the range, from the byte totals. */
  totalIn: number;
  totalOut: number;
  /** End of the newest finished window. */
  lastSampleAt: number | null;
}

export interface PingStats {
  current: number | null;
  peak: Peak | null;
  average: number | null;
  /** Percent of pings in the range that got no answer, or null when there were none. */
  timeoutShare: number | null;
  timeouts: number;
  lastSampleAt: number | null;
}

interface SeriesBase {
  from: number;
  to: number;
  bucketSeconds: number;
  events: MetricEvent[];
}

export type MetricSeries =
  | (SeriesBase & { metric: 'bandwidth'; points: BandwidthPoint[]; stats: BandwidthStats })
  | (SeriesBase & { metric: 'ping'; points: PingPoint[]; stats: PingStats });

const round1 = (value: number) => Math.round(value * 10) / 10;

interface Grid {
  from: number;
  to: number;
  bucketSeconds: number;
  bucketMs: number;
  gridStart: number;
  bucketCount: number;
  leadBuckets: number;
  total: number;
}

/** The same bucket grid the user chart uses, so the metrics line up with it and share its ranges. */
function buildGrid(rows: RollupSampleRow[], range: UserHistoryRange, now: number): Grid {
  const spec = USER_HISTORY_RANGES[range];
  const to = now;
  const from = now - spec.seconds * 1000;

  // A bucket must be at least one interval wide, or a slow interval would leave most of them empty.
  let widestIntervalSec = 0;
  for (const r of rows) if (r.t >= from && r.intervalSec > widestIntervalSec) widestIntervalSec = r.intervalSec;
  const bucketSeconds = Math.max(spec.bucketSeconds, Math.ceil(widestIntervalSec / 60) * 60);
  const bucketMs = bucketSeconds * 1000;

  const gridStart = Math.floor(from / bucketMs) * bucketMs;
  const bucketCount = Math.ceil((to - gridStart) / bucketMs);
  const leadBuckets = Math.ceil(DAY_MS / bucketMs);
  return { from, to, bucketSeconds, bucketMs, gridStart, bucketCount, leadBuckets, total: leadBuckets + bucketCount };
}

/** Running sums so a trailing 24-hour window is one subtraction per bucket. */
function prefix(values: number[]): number[] {
  const sums = new Array<number>(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i++) sums[i + 1] = sums[i] + values[i];
  return sums;
}

/**
 * Time nobody measured: a hole between two rollup rows much longer than their
 * interval (the backend was not running, or recording was off), and the stretch
 * from the newest row up to now. Nothing is reported before the very first row.
 */
function noDataEvents(rows: RollupSampleRow[], to: number): MetricEvent[] {
  const events: MetricEvent[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const intervalMs = row.intervalSec * 1000;
    const nextAt = i + 1 < rows.length ? rows[i + 1].t : to;
    if (nextAt - row.t > GAP_FACTOR * intervalMs) {
      events.push({ kind: 'nodata', from: row.t + intervalMs, to: nextAt });
    }
  }
  return events;
}

/** Windows in which a ping got no answer, merged where they touch. */
function pingTimeoutEvents(rows: RollupSampleRow[]): MetricEvent[] {
  const events: MetricEvent[] = [];
  for (const row of rows) {
    if (row.pingFailed === 0) continue;
    const from = row.t;
    const to = row.t + row.intervalSec * 1000;
    const last = events[events.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else events.push({ kind: 'pingtimeout', from, to });
  }
  return events;
}

/**
 * `spans` with every part that lies inside one of `cut` taken out. Both lists
 * are short (one entry per outage), so the plain nested loop is plenty.
 */
function without(spans: MetricEvent[], cut: MetricEvent[]): MetricEvent[] {
  let result = spans;
  for (const c of cut) {
    const next: MetricEvent[] = [];
    for (const s of result) {
      if (c.to <= s.from || c.from >= s.to) {
        next.push(s);
        continue;
      }
      if (s.from < c.from) next.push({ ...s, to: c.from });
      if (s.to > c.to) next.push({ ...s, from: c.to });
    }
    result = next;
  }
  return result;
}

/**
 * The rows whose window does not touch an outage. A stopped virtual server
 * still answers the connection info - with running totals of zero - so the
 * windows in which it was stopped hold readings that look like "0 bytes per
 * second" but say nothing about traffic. The chart leaves them out, the way the
 * user chart has no line while a server is stopped. Rows and outages are both
 * in time order, so one sweep is enough.
 */
function withoutOutages(rows: RollupSampleRow[], outages: MetricEvent[]): RollupSampleRow[] {
  const kept: RollupSampleRow[] = [];
  let next = 0;
  for (const row of rows) {
    while (next < outages.length && outages[next].to <= row.t) next += 1;
    const touches = next < outages.length && outages[next].from < row.t + row.intervalSec * 1000;
    if (!touches) kept.push(row);
  }
  return kept;
}

function combineEvents(
  metric: MetricKind,
  rows: RollupSampleRow[],
  outages: MetricEvent[],
  from: number,
  to: number,
): MetricEvent[] {
  // While the virtual server is known to be down, nothing was measured and every
  // ping failed - because of the outage, which is already marked. Saying "no
  // measurement" or "ping timeout" on top of it would be the same thing twice.
  const own = without(
    [...noDataEvents(rows, to), ...(metric === 'ping' ? pingTimeoutEvents(rows) : [])],
    outages,
  );
  return [...outages, ...own]
    .map((e) => ({ kind: e.kind, from: Math.max(e.from, from), to: Math.min(e.to, to) }))
    .filter((e) => e.to > e.from)
    .sort((a, b) => a.from - b.from);
}

/**
 * @param metric   Which chart to build.
 * @param rows     The virtual server's rollup rows from (window start - 24h) to now, oldest first.
 * @param userRows Its user-count rows over the same stretch, used only for the unreachable and stopped marks.
 * @param range    The requested window.
 * @param now      The end of the window, unix milliseconds.
 */
export function buildMetricHistory(
  metric: MetricKind,
  rows: RollupSampleRow[],
  userRows: UserSampleRow[],
  range: UserHistoryRange,
  now: number,
): MetricSeries {
  const g = buildGrid(rows, range, now);
  // Unreachable and stopped come from the per-tick states of the user-count rows
  // (taken over the lead-in day too, so the rows of the trailing average are
  // covered); "no measurement" is judged on the metric's own rows, since a
  // virtual server can be up while its connection info is not being read.
  const outages = buildUserEvents(userRows, g.from - DAY_MS, g.to).filter((e) => e.kind !== 'nodata');
  // The ping is a TCP connect to a host, which works just the same while a
  // virtual server on it is stopped, so only the bandwidth drops those windows.
  const used = metric === 'bandwidth' ? withoutOutages(rows, outages) : rows;
  const events = combineEvents(metric, used, outages, g.from, g.to);
  const base = { from: g.from, to: g.to, bucketSeconds: g.bucketSeconds, events };
  return metric === 'bandwidth'
    ? { metric, ...base, ...buildBandwidth(used, g) }
    : { metric, ...base, ...buildPing(used, g) };
}

function buildBandwidth(rows: RollupSampleRow[], g: Grid): { points: BandwidthPoint[]; stats: BandwidthStats } {
  const inBytes = new Array<number>(g.total).fill(0);
  const outBytes = new Array<number>(g.total).fill(0);
  const span = new Array<number>(g.total).fill(0);
  const peakIn = new Array<number | null>(g.total).fill(null);
  const peakOut = new Array<number | null>(g.total).fill(null);

  for (const r of rows) {
    const index = Math.floor((r.t - g.gridStart) / g.bucketMs) + g.leadBuckets;
    if (index < 0 || index >= g.total) continue;
    if (r.bytesIn !== null && r.bytesOut !== null && r.spanSec !== null && r.spanSec > 0) {
      inBytes[index] += r.bytesIn;
      outBytes[index] += r.bytesOut;
      span[index] += r.spanSec;
    }
    if (r.peakIn !== null && (peakIn[index] === null || r.peakIn > (peakIn[index] as number))) peakIn[index] = r.peakIn;
    if (r.peakOut !== null && (peakOut[index] === null || r.peakOut > (peakOut[index] as number))) peakOut[index] = r.peakOut;
  }

  const pIn = prefix(inBytes);
  const pOut = prefix(outBytes);
  const pSpan = prefix(span);

  const points: BandwidthPoint[] = [];
  for (let i = 0; i < g.bucketCount; i++) {
    const index = g.leadBuckets + i;
    const t = g.gridStart + i * g.bucketMs;
    const hasRate = span[index] > 0;
    // The 24 hours ending with this bucket; null wherever the bucket itself has no rate, so the
    // dashed line breaks exactly where the solid one does.
    const windowSpan = pSpan[index + 1] - pSpan[index + 1 - g.leadBuckets];
    points.push({
      t,
      avgIn: hasRate ? Math.round(inBytes[index] / span[index]) : null,
      avgOut: hasRate ? Math.round(outBytes[index] / span[index]) : null,
      peakIn: peakIn[index],
      peakOut: peakOut[index],
      avg24hIn: hasRate && windowSpan > 0 ? Math.round((pIn[index + 1] - pIn[index + 1 - g.leadBuckets]) / windowSpan) : null,
      avg24hOut: hasRate && windowSpan > 0 ? Math.round((pOut[index + 1] - pOut[index + 1 - g.leadBuckets]) / windowSpan) : null,
    });
  }

  let totalIn = 0;
  let totalOut = 0;
  let totalSpan = 0;
  let peakInBest: Peak | null = null;
  let peakOutBest: Peak | null = null;
  for (const r of rows) {
    if (r.t < g.from) continue;
    if (r.bytesIn !== null && r.bytesOut !== null && r.spanSec !== null && r.spanSec > 0) {
      totalIn += r.bytesIn;
      totalOut += r.bytesOut;
      totalSpan += r.spanSec;
    }
    // `>` keeps the first time a peak was reached.
    if (r.peakIn !== null && (peakInBest === null || r.peakIn > peakInBest.value)) peakInBest = { value: r.peakIn, at: r.t };
    if (r.peakOut !== null && (peakOutBest === null || r.peakOut > peakOutBest.value)) peakOutBest = { value: r.peakOut, at: r.t };
  }

  const newest = rows.length > 0 ? rows[rows.length - 1] : null;
  const fresh = newest !== null && g.to - newest.t <= (GAP_FACTOR + 1) * newest.intervalSec * 1000;
  const newestHasRate = newest !== null && newest.bytesIn !== null && newest.bytesOut !== null && newest.spanSec !== null && newest.spanSec > 0;

  return {
    points,
    stats: {
      currentIn: fresh && newestHasRate ? Math.round((newest!.bytesIn as number) / (newest!.spanSec as number)) : null,
      currentOut: fresh && newestHasRate ? Math.round((newest!.bytesOut as number) / (newest!.spanSec as number)) : null,
      peakIn: peakInBest,
      peakOut: peakOutBest,
      averageIn: totalSpan > 0 ? Math.round(totalIn / totalSpan) : null,
      averageOut: totalSpan > 0 ? Math.round(totalOut / totalSpan) : null,
      totalIn,
      totalOut,
      lastSampleAt: newest ? newest.t + newest.intervalSec * 1000 : null,
    },
  };
}

function buildPing(rows: RollupSampleRow[], g: Grid): { points: PingPoint[]; stats: PingStats } {
  const okSum = new Array<number>(g.total).fill(0);
  const okCount = new Array<number>(g.total).fill(0);
  const failed = new Array<number>(g.total).fill(0);
  const minV = new Array<number | null>(g.total).fill(null);
  const maxV = new Array<number | null>(g.total).fill(null);

  for (const r of rows) {
    const index = Math.floor((r.t - g.gridStart) / g.bucketMs) + g.leadBuckets;
    if (index < 0 || index >= g.total) continue;
    failed[index] += r.pingFailed;
    if (r.pingOk > 0 && r.pingAvg !== null) {
      okSum[index] += r.pingAvg * r.pingOk;
      okCount[index] += r.pingOk;
      if (r.pingMin !== null && (minV[index] === null || r.pingMin < (minV[index] as number))) minV[index] = r.pingMin;
      if (r.pingMax !== null && (maxV[index] === null || r.pingMax > (maxV[index] as number))) maxV[index] = r.pingMax;
    }
  }

  const pSum = prefix(okSum);
  const pCount = prefix(okCount);

  const points: PingPoint[] = [];
  for (let i = 0; i < g.bucketCount; i++) {
    const index = g.leadBuckets + i;
    const t = g.gridStart + i * g.bucketMs;
    const hasPing = okCount[index] > 0;
    const windowCount = pCount[index + 1] - pCount[index + 1 - g.leadBuckets];
    points.push({
      t,
      avg: hasPing ? round1(okSum[index] / okCount[index]) : null,
      min: minV[index],
      max: maxV[index],
      avg24h: hasPing && windowCount > 0 ? round1((pSum[index + 1] - pSum[index + 1 - g.leadBuckets]) / windowCount) : null,
      failed: failed[index],
    });
  }

  let sum = 0;
  let count = 0;
  let timeouts = 0;
  let peak: Peak | null = null;
  for (const r of rows) {
    if (r.t < g.from) continue;
    timeouts += r.pingFailed;
    if (r.pingOk > 0 && r.pingAvg !== null) {
      sum += r.pingAvg * r.pingOk;
      count += r.pingOk;
    }
    if (r.pingMax !== null && (peak === null || r.pingMax > peak.value)) peak = { value: r.pingMax, at: r.t };
  }

  const newest = rows.length > 0 ? rows[rows.length - 1] : null;
  const fresh = newest !== null && g.to - newest.t <= (GAP_FACTOR + 1) * newest.intervalSec * 1000;
  const totalPings = count + timeouts;

  return {
    points,
    stats: {
      current: fresh && newest!.pingAvg !== null ? newest!.pingAvg : null,
      peak,
      average: count > 0 ? round1(sum / count) : null,
      timeoutShare: totalPings > 0 ? round1((timeouts / totalPings) * 100) : null,
      timeouts,
      lastSampleAt: newest ? newest.t + newest.intervalSec * 1000 : null,
    },
  };
}
