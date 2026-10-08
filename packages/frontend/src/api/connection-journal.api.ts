import type {
  ConnectionJournalIpPage,
  ConnectionJournalPage,
  ConnectionJournalSettingsDto,
  JournalEvent,
  JournalIpSortColumn,
  JournalRange,
  JournalResult,
  JournalSortColumn,
  JournalSource,
} from '@ts6/common';
import api from './client';

/** What narrows the list; an empty field is left out of the request. */
export interface JournalQuery {
  range: JournalRange;
  source?: JournalSource;
  event?: JournalEvent;
  result?: JournalResult;
  q?: string;
  ip?: string;
  page: number;
  pageSize: number;
}

const clean = <T extends object>(params: T) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== ''));

export const connectionJournalApi = {
  list: (query: JournalQuery & { sort: JournalSortColumn; order: 'asc' | 'desc' }): Promise<ConnectionJournalPage> =>
    api.get('/connection-journal', { params: clean(query) }).then((r) => r.data),

  byIp: (query: JournalQuery & { sort: JournalIpSortColumn; order: 'asc' | 'desc' }): Promise<ConnectionJournalIpPage> =>
    api.get('/connection-journal/by-ip', { params: clean(query) }).then((r) => r.data),

  getSettings: (): Promise<ConnectionJournalSettingsDto> =>
    api.get('/connection-journal/settings').then((r) => r.data),

  setSettings: (values: { enabled: boolean; retentionDays: number; maxRows: number }): Promise<ConnectionJournalSettingsDto> =>
    api.put('/connection-journal/settings', values).then((r) => r.data),

  clear: (): Promise<{ deletedCount: number }> =>
    api.delete('/connection-journal').then((r) => r.data),
};
