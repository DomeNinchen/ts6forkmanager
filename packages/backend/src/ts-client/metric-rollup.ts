/**
 * Rolls the bandwidth and ping measurements BandwidthSampler takes every 30
 * seconds up into one row per history interval, for the long-term charts. Pure
 * bookkeeping - no database, no clock of its own - so it can be exercised
 * without a server.
 */

import { GAP_FACTOR } from '../utils/user-history-series.js';

/** One measurement of one virtual server, as BandwidthSampler takes it. */
export interface MetricReading {
  /** When it was taken, unix milliseconds. */
  at: number;
  /** The server's running total of bytes received / sent (connection_bytes_*_total); null when it did not report one. */
  counterIn: number | null;
  counterOut: number | null;
  /** The "last second" rate in bytes per second (connection_bandwidth_*_last_second_total). */
  rateIn: number;
  rateOut: number;
  /** Round-trip time of the TCP ping in milliseconds, or -1 when it failed. */
  ping: number;
}

/** Everything the long-term table stores for one finished window, minus the virtual server it belongs to. */
export interface RollupRow {
  /** Start of the window. */
  measuredAt: Date;
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

/** Whoever wants the measurements; implemented by UserHistorySampler, which owns the interval and the storage. */
export interface MetricSink {
  recordMetric(configId: number, sid: number, reading: MetricReading): void;
}

interface Counters {
  at: number;
  in: number;
  out: number;
}

interface Window {
  start: number;
  intervalSec: number;
  peakIn: number | null;
  peakOut: number | null;
  pingOkSum: number;
  pingOk: number;
  pingFailed: number;
  pingMin: number | null;
  pingMax: number | null;
  /** The reading the byte difference is measured from. */
  baseline: Counters | null;
  /** The newest counter reading in this window. */
  last: Counters | null;
  /** A total went backwards inside this window, so its difference would be wrong. */
  reset: boolean;
}

export class MetricRollup {
  private windows = new Map<string, Window>();

  /**
   * Adds one measurement. Returns the finished row of the previous window when
   * this measurement is the first of a new one, otherwise null.
   *
   * Windows are aligned to multiples of the interval since the epoch, so a
   * restart does not shift them. The byte difference of a window is measured
   * from the last reading of the window before it, which is what makes the
   * windows add up exactly: nothing falls between two of them.
   */
  add(key: string, reading: MetricReading, intervalSec: number): RollupRow | null {
    const intervalMs = intervalSec * 1000;
    const start = Math.floor(reading.at / intervalMs) * intervalMs;

    let finished: RollupRow | null = null;
    let win = this.windows.get(key);
    if (win && (win.start !== start || win.intervalSec !== intervalSec)) {
      finished = this.finish(win);
      win = this.fresh(start, intervalSec, win.last ?? win.baseline);
      this.windows.set(key, win);
    } else if (!win) {
      win = this.fresh(start, intervalSec, null);
      this.windows.set(key, win);
    }

    if (win.peakIn === null || reading.rateIn > win.peakIn) win.peakIn = reading.rateIn;
    if (win.peakOut === null || reading.rateOut > win.peakOut) win.peakOut = reading.rateOut;

    if (reading.ping >= 0) {
      win.pingOk += 1;
      win.pingOkSum += reading.ping;
      if (win.pingMin === null || reading.ping < win.pingMin) win.pingMin = reading.ping;
      if (win.pingMax === null || reading.ping > win.pingMax) win.pingMax = reading.ping;
    } else {
      win.pingFailed += 1;
    }

    if (reading.counterIn !== null && reading.counterOut !== null) {
      const cur: Counters = { at: reading.at, in: reading.counterIn, out: reading.counterOut };
      const prev = win.last ?? win.baseline;
      if (prev && (cur.in < prev.in || cur.out < prev.out)) {
        // The virtual server restarted and its totals began again from zero.
        // Nothing before this reading is comparable with what follows.
        win.reset = true;
        win.baseline = cur;
        win.last = cur;
      } else if (prev && cur.at - prev.at > GAP_FACTOR * intervalMs) {
        // Too long since the last reading - the same 2.5 intervals after which
        // the charts call a hole in the rows a gap - to say when the bytes
        // moved. They are real but belong to no window: smearing them over
        // this one would draw a spike.
        win.baseline = cur;
        win.last = cur;
      } else {
        if (!win.baseline) win.baseline = cur;
        win.last = cur;
      }
    }

    return finished;
  }

  /** Finishes every open window, e.g. at shutdown, so the last partial one is not lost. */
  flushAll(): Array<{ key: string; row: RollupRow }> {
    const rows: Array<{ key: string; row: RollupRow }> = [];
    for (const [key, win] of this.windows) rows.push({ key, row: this.finish(win) });
    this.windows.clear();
    return rows;
  }

  private fresh(start: number, intervalSec: number, carry: Counters | null): Window {
    return {
      start,
      intervalSec,
      peakIn: null,
      peakOut: null,
      pingOkSum: 0,
      pingOk: 0,
      pingFailed: 0,
      pingMin: null,
      pingMax: null,
      baseline: carry,
      last: null,
      reset: false,
    };
  }

  private finish(win: Window): RollupRow {
    const delta =
      !win.reset && win.baseline !== null && win.last !== null && win.last.at > win.baseline.at
        ? { bytesIn: win.last.in - win.baseline.in, bytesOut: win.last.out - win.baseline.out, spanSec: Math.round((win.last.at - win.baseline.at) / 1000) }
        : null;

    return {
      measuredAt: new Date(win.start),
      intervalSec: win.intervalSec,
      bytesIn: delta?.bytesIn ?? null,
      bytesOut: delta?.bytesOut ?? null,
      spanSec: delta?.spanSec ?? null,
      peakIn: win.peakIn,
      peakOut: win.peakOut,
      pingOk: win.pingOk,
      pingFailed: win.pingFailed,
      pingAvg: win.pingOk > 0 ? Math.round(win.pingOkSum / win.pingOk) : null,
      pingMin: win.pingMin,
      pingMax: win.pingMax,
    };
  }
}
