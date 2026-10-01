import type { UserHistoryRange } from '@/api/statistics.api';

/**
 * Which clock the History chart reads in. Everything is stored and sent as UTC
 * instants; this only decides where a day begins, which days are the weekend,
 * and how the labels are written.
 */
export type HistoryTimeZone = 'local' | 'utc';

const STORAGE_KEY = 'ts6-history-timezone';

/** The viewer's last choice, or their own clock on a first visit (and wherever storage is unavailable, e.g. some private windows). */
export function readStoredTimeZone(): HistoryTimeZone {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'utc' ? 'utc' : 'local';
  } catch {
    return 'local';
  }
}

export function storeTimeZone(tz: HistoryTimeZone): void {
  try {
    localStorage.setItem(STORAGE_KEY, tz);
  } catch {
    // Not remembering the choice is fine; it just resets to local next visit.
  }
}

/** The browser's own zone as an IANA name (e.g. "Europe/Berlin"), for labelling the "local" choice. */
export function localTimeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    return 'local';
  }
}

const HOUR_MS = 3_600_000;

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
}

function partsOf(ms: number, tz: HistoryTimeZone): DateParts {
  const d = new Date(ms);
  return tz === 'utc'
    ? { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), weekday: d.getUTCDay() }
    : { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), weekday: d.getDay() };
}

/**
 * Midnight of the day containing `ms` in the chosen zone, moved by whole
 * calendar days. Stepping through the calendar rather than adding 24 hours is
 * what keeps a local day 23 or 25 hours long on the day the clocks change.
 */
function dayStart(ms: number, tz: HistoryTimeZone, dayOffset = 0): number {
  const p = partsOf(ms, tz);
  return tz === 'utc'
    ? Date.UTC(p.year, p.month, p.day + dayOffset)
    : new Date(p.year, p.month, p.day + dayOffset).getTime();
}

function hourStart(ms: number, tz: HistoryTimeZone): number {
  if (tz === 'utc') return Math.floor(ms / HOUR_MS) * HOUR_MS;
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

export interface WeekendArea {
  kind: 'saturday' | 'sunday';
  from: number;
  to: number;
}

/** The Saturdays and Sundays inside [from, to] in the chosen zone, clipped to that window. */
export function weekendAreas(from: number, to: number, tz: HistoryTimeZone): WeekendArea[] {
  const areas: WeekendArea[] = [];
  for (let start = dayStart(from, tz); start < to; start = dayStart(start, tz, 1)) {
    const { weekday } = partsOf(start, tz);
    if (weekday !== 6 && weekday !== 0) continue;
    areas.push({
      kind: weekday === 6 ? 'saturday' : 'sunday',
      from: Math.max(start, from),
      to: Math.min(dayStart(start, tz, 1), to),
    });
  }
  return areas;
}

/**
 * Where the time axis puts its labels: on the hour for the shorter windows,
 * on midnights for the longer ones - so the labels line up with the weekend
 * bands instead of falling at arbitrary moments.
 */
const TICK_STEPS: Record<UserHistoryRange, { unit: 'hour' | 'day'; every: number }> = {
  '24h': { unit: 'hour', every: 3 },
  '3d': { unit: 'hour', every: 12 },
  '7d': { unit: 'day', every: 1 },
  '14d': { unit: 'day', every: 2 },
  '31d': { unit: 'day', every: 4 },
};

export function axisTicks(from: number, to: number, range: UserHistoryRange, tz: HistoryTimeZone): number[] {
  const { unit, every } = TICK_STEPS[range];
  const ticks: number[] = [];

  if (unit === 'hour') {
    // Walked hour by hour and filtered by the zone's own hour of day, rather
    // than stepping a fixed number of milliseconds, so a daylight-saving
    // change doesn't move the labels off the hours they belong on.
    for (let t = hourStart(from, tz); t <= to; t += HOUR_MS) {
      if (t >= from && partsOf(t, tz).hour % every === 0) ticks.push(t);
    }
  } else {
    for (let t = dayStart(from, tz); t <= to; t = dayStart(t, tz, every)) {
      if (t >= from) ticks.push(t);
    }
  }
  return ticks;
}

const zoneOption = (tz: HistoryTimeZone) => (tz === 'utc' ? { timeZone: 'UTC' } : {});

/** A label for one axis tick, in the shape that suits the window. */
export function formatAxisTick(ms: number, range: UserHistoryRange, tz: HistoryTimeZone, locale: string): string {
  switch (range) {
    case '24h':
      return new Intl.DateTimeFormat(locale, { ...zoneOption(tz), hour: '2-digit', minute: '2-digit' }).format(ms);
    case '3d':
      return new Intl.DateTimeFormat(locale, { ...zoneOption(tz), weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
    default:
      return new Intl.DateTimeFormat(locale, { ...zoneOption(tz), weekday: 'short', day: '2-digit', month: '2-digit' }).format(ms);
  }
}

export function formatDateTime(ms: number, tz: HistoryTimeZone, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    ...zoneOption(tz),
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms);
}

export function formatTimeOnly(ms: number, tz: HistoryTimeZone, locale: string): string {
  return new Intl.DateTimeFormat(locale, { ...zoneOption(tz), hour: '2-digit', minute: '2-digit' }).format(ms);
}

/** "30 s", "1 min", "2 min", "5 min" - the sampling interval and the chart's bucket width. */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}
