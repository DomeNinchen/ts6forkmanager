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

export const statisticsApi = {
  userHistory: (configId: number, sid: number, range: UserHistoryRange): Promise<UserHistoryResponse> =>
    api
      .get(`/servers/${configId}/vs/${sid}/statistics/user-history`, { params: { range } })
      .then((r) => r.data),
};
