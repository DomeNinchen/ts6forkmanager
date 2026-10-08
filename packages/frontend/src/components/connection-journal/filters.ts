import type { JournalEvent, JournalRange, JournalResult } from '@ts6/common';
import type { JournalQuery } from '@/api/connection-journal.api';

/** What the filter bar holds; `all` stands for "do not narrow by this". */
export interface JournalFilterState {
  range: JournalRange;
  event: JournalEvent | 'all';
  result: JournalResult | 'all';
  /** Part of an account name or an address. */
  q: string;
  /** Exactly this address - set by clicking one in the table. */
  ip: string;
}

export const DEFAULT_FILTERS: JournalFilterState = { range: '7d', event: 'all', result: 'all', q: '', ip: '' };

export function toQuery(filters: JournalFilterState, page: number, pageSize: number): JournalQuery {
  return {
    range: filters.range,
    event: filters.event === 'all' ? undefined : filters.event,
    result: filters.result === 'all' ? undefined : filters.result,
    q: filters.q.trim() || undefined,
    ip: filters.ip || undefined,
    page,
    pageSize,
  };
}
