import type { JournalEvent, JournalRange, JournalResult, JournalSource } from '@ts6/common';
import type { JournalQuery } from '@/api/connection-journal.api';

/** What the filter bar holds; `all` stands for "do not narrow by this". */
export interface JournalFilterState {
  range: JournalRange;
  source: JournalSource | 'all';
  event: JournalEvent | 'all';
  result: JournalResult | 'all';
  /** Part of an account, a nickname, a unique ID, a connection name or an address. */
  q: string;
  /** Exactly this address - set by clicking one in the table. */
  ip: string;
  /** TeamSpeak only: the id of a server connection. */
  server: number | 'all';
  /** TeamSpeak only: just the clients that are on the server now. */
  online: boolean;
  /** An ISO 3166-1 alpha-2 code. */
  country: string | 'all';
}

export const DEFAULT_FILTERS: JournalFilterState = {
  range: '7d', source: 'all', event: 'all', result: 'all', q: '', ip: '', server: 'all', online: false, country: 'all',
};

export function toQuery(filters: JournalFilterState, page: number, pageSize: number): JournalQuery {
  return {
    range: filters.range,
    source: filters.source === 'all' ? undefined : filters.source,
    event: filters.event === 'all' ? undefined : filters.event,
    result: filters.result === 'all' ? undefined : filters.result,
    q: filters.q.trim() || undefined,
    ip: filters.ip || undefined,
    online: filters.online || undefined,
    server: filters.server === 'all' ? undefined : filters.server,
    country: filters.country === 'all' ? undefined : filters.country,
    page,
    pageSize,
  };
}
