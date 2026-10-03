import api from './client';

/** The chart windows the backend offers, every one of them ending "now". */
export const USER_HISTORY_RANGES = ['24h', '3d', '7d', '14d', '31d'] as const;
export type UserHistoryRange = (typeof USER_HISTORY_RANGES)[number];

export type UserSampleState = 'online' | 'stopped' | 'unreachable';

/**
 * What the chart marks besides the line. "nodata" is time nobody measured at
 * all (the backend was not running, or recording was switched off) - as
 * opposed to a measurement that said the server was unreachable or stopped.
 */
export type UserHistoryEventKind = 'unreachable' | 'stopped' | 'nodata';

/** One time bucket of the window. Empty buckets are present, with nulls - never a 0. */
export interface UserHistoryPoint {
  /** Bucket start, unix milliseconds. */
  t: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  /** Mean of every online sample in the 24 hours up to the end of this bucket. */
  avg24h: number | null;
  /** The slot limit in force at the end of the bucket; null when unknown (older rows, empty bucket). */
  slots: number | null;
}

export interface UserHistoryEvent {
  kind: UserHistoryEventKind;
  /** Unix milliseconds, clipped to the requested window. */
  from: number;
  to: number;
}

export interface UserHistoryStats {
  current: number | null;
  currentState: UserSampleState | 'nodata' | null;
  /** `slots` is the limit that applied when the peak was reached, or null when unknown. */
  peak: { users: number; at: number; slots: number | null } | null;
  average: number | null;
  /** Percent of measured time the virtual server was online. */
  availability: number | null;
  lastSampleAt: number | null;
}

export interface UserHistoryResponse {
  range: UserHistoryRange;
  from: number;
  to: number;
  bucketSeconds: number;
  points: UserHistoryPoint[];
  events: UserHistoryEvent[];
  stats: UserHistoryStats;
  /** What the recording card shows, so it doesn't need a second request. */
  intervalSeconds: number;
  retentionDays: number;
  /** Whether this connection currently has recording switched on. */
  recording: boolean;
  /** When the first sample of this virtual server was taken, or null if there is none yet. */
  firstSampleAt: number | null;
}

/**
 * What the History tab can plot. "users" is the original chart; the other two
 * are rolled up from the bandwidth and ping the backend measures anyway.
 */
export type HistoryMetric = 'users' | 'bandwidth' | 'ping';
export const HISTORY_METRICS: readonly HistoryMetric[] = ['users', 'bandwidth', 'ping'];
export type MetricKind = Exclude<HistoryMetric, 'users'>;

/** The user chart's marks plus the one only the ping chart has: the ping target did not answer. */
export type MetricEventKind = UserHistoryEventKind | 'pingtimeout';

export interface MetricHistoryEvent {
  kind: MetricEventKind;
  /** Unix milliseconds, clipped to the requested window. */
  from: number;
  to: number;
}

/** The highest value of the range and when it was measured. */
export interface MetricPeak {
  value: number;
  at: number;
}

/** One time bucket of the bandwidth chart. Rates are bytes per second; empty buckets are present, with nulls. */
export interface BandwidthPoint {
  /** Bucket start, unix milliseconds. */
  t: number;
  /** Mean rate in the bucket, exact: from the difference of the server's byte totals. */
  avgIn: number | null;
  avgOut: number | null;
  /** Highest sampled "last second" rate in the bucket - a floor for the real peak, since it is sampled, not tracked. */
  peakIn: number | null;
  peakOut: number | null;
  /** Mean rate over the 24 hours up to the end of this bucket; null wherever the bucket itself is empty. */
  avg24hIn: number | null;
  avg24hOut: number | null;
}

/** One time bucket of the ping chart, in milliseconds. A timeout is never a value here: it only counts in `failed`. */
export interface PingPoint {
  t: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  avg24h: number | null;
  /** How many pings in the bucket got no answer. */
  failed: number;
}

export interface BandwidthStats {
  /** Rate of the newest finished window, when it is recent enough to mean "now". */
  currentIn: number | null;
  currentOut: number | null;
  peakIn: MetricPeak | null;
  peakOut: MetricPeak | null;
  /** Exact mean rate over the range, from the byte totals. */
  averageIn: number | null;
  averageOut: number | null;
  /** Bytes moved in the range, from the byte totals. */
  totalIn: number;
  totalOut: number;
  lastSampleAt: number | null;
}

export interface PingStats {
  current: number | null;
  peak: MetricPeak | null;
  average: number | null;
  /** Percent of the range's pings that got no answer, or null when there were none. */
  timeoutShare: number | null;
  timeouts: number;
  lastSampleAt: number | null;
}

interface MetricHistoryBase {
  range: UserHistoryRange;
  from: number;
  to: number;
  bucketSeconds: number;
  events: MetricHistoryEvent[];
  /** What the recording card shows, so it doesn't need a second request. */
  intervalSeconds: number;
  retentionDays: number;
  /** Whether this connection currently has recording switched on. */
  recording: boolean;
  /** When the first bandwidth/ping window of this virtual server was stored, or null if there is none yet. */
  firstSampleAt: number | null;
  /** What the ping measures: a TCP connect to this host and port. */
  pingTarget: { host: string; port: number };
}

export type BandwidthHistoryResponse = MetricHistoryBase & {
  metric: 'bandwidth';
  points: BandwidthPoint[];
  stats: BandwidthStats;
};

export type PingHistoryResponse = MetricHistoryBase & {
  metric: 'ping';
  points: PingPoint[];
  stats: PingStats;
};

export type MetricHistoryResponse = BandwidthHistoryResponse | PingHistoryResponse;

export const statisticsApi = {
  userHistory: (configId: number, sid: number, range: UserHistoryRange): Promise<UserHistoryResponse> =>
    api
      .get(`/servers/${configId}/vs/${sid}/statistics/user-history`, { params: { range } })
      .then((r) => r.data),

  metricHistory: (configId: number, sid: number, metric: MetricKind, range: UserHistoryRange): Promise<MetricHistoryResponse> =>
    api
      .get(`/servers/${configId}/vs/${sid}/statistics/metric-history`, { params: { metric, range } })
      .then((r) => r.data),
};
