import { formatBytes } from '@/lib/utils';

/** "1.5 KB/s" - the dashboard's own notation (1 KB = 1024 B). */
export const formatRate = (bytesPerSecond: number): string => `${formatBytes(bytesPerSecond)}/s`;

/** One decimal for the small numbers, none from 100 up: "4.5 ms", "86 ms". */
export const formatMillis = (ms: number): string => `${ms >= 100 ? Math.round(ms) : parseFloat(ms.toFixed(1))} ms`;

/** The next of 1, 2, 5 times a power of ten at or above `raw` - the step a human would put between two axis ticks. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}

export interface NiceScale {
  /** Tick positions, 0 first, evenly spaced. */
  ticks: number[];
  /** The top of the axis: the last tick, at or above the highest value. */
  max: number;
}

/** An axis from 0 up past `highest` in about `divisions` round steps. */
export function niceScale(highest: number, divisions = 4): NiceScale {
  const step = niceStep(Math.max(highest, Number.MIN_VALUE) / divisions);
  const count = Math.ceil(highest / step - 1e-9);
  return { ticks: Array.from({ length: count + 1 }, (_, i) => i * step), max: count * step };
}

const RATE_UNITS = [
  { size: 1, label: 'B/s' },
  { size: 1024, label: 'KB/s' },
  { size: 1024 ** 2, label: 'MB/s' },
  { size: 1024 ** 3, label: 'GB/s' },
] as const;

/** A space the axis labels do not break at, so "300 ms" never wraps into two lines. */
const NBSP = ' ';

/** An axis label for a millisecond value: "300 ms". */
export const formatMillisTick = (ms: number): string => `${parseFloat(ms.toFixed(2))}${NBSP}ms`;

export interface RateScale extends NiceScale {
  /** Writes a tick value in the one unit the whole axis uses, so the ticks read 0, 0.5, 1, 1.5 KB/s instead of 512 B, 1 KB, 1.5 KB. */
  format: (bytesPerSecond: number) => string;
}

/**
 * A bytes-per-second axis whose ticks are round numbers in the unit that suits
 * its size. A quiet server (a few hundred B/s) and a busy one (a few MB/s)
 * both get a readable axis; the floor keeps a server that moved nothing at all
 * from collapsing it to zero height.
 */
export function rateScale(highest: number): RateScale {
  const top = Math.max(highest, 100);
  let unit = 0;
  while (unit < RATE_UNITS.length - 1 && top >= RATE_UNITS[unit + 1].size) unit += 1;
  const { size, label } = RATE_UNITS[unit];
  const scale = niceScale(top / size);
  return {
    ticks: scale.ticks.map((tick) => tick * size),
    max: scale.max * size,
    format: (bytesPerSecond) => `${parseFloat((bytesPerSecond / size).toFixed(2))}${NBSP}${label}`,
  };
}
