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
