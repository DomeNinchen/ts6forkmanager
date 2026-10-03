import { HISTORY_METRICS, type HistoryMetric } from '@/api/statistics.api';

const SHOW_SLOTS_KEY = 'ts6-history-show-slots';

/**
 * Whether the viewer last switched the slot-limit line on. Off by default: on a
 * server with many slots and few users the axis would otherwise stretch up to
 * the limit and flatten the curve nobody came to look at.
 */
export function readStoredShowSlots(): boolean {
  try {
    return localStorage.getItem(SHOW_SLOTS_KEY) === '1';
  } catch {
    return false;
  }
}

export function storeShowSlots(show: boolean): void {
  try {
    localStorage.setItem(SHOW_SLOTS_KEY, show ? '1' : '0');
  } catch {
    // Not remembering the choice is fine; it just resets next visit.
  }
}

const METRIC_KEY = 'ts6-history-metric';

/** Which chart the viewer looked at last, so coming back to the tab shows it again; the user count on a first visit. */
export function readStoredMetric(): HistoryMetric {
  try {
    const stored = localStorage.getItem(METRIC_KEY);
    return HISTORY_METRICS.find((m) => m === stored) ?? 'users';
  } catch {
    return 'users';
  }
}

export function storeMetric(metric: HistoryMetric): void {
  try {
    localStorage.setItem(METRIC_KEY, metric);
  } catch {
    // Not remembering the choice is fine; it just resets next visit.
  }
}
