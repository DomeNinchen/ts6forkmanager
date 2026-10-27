import type {
  UiChangeLogPage,
  UiChangeLogSettingsDto,
  UiChangeMethod,
  UiChangeRange,
  UiChangeStatus,
} from '@ts6/common';
import api from './client';

/** What narrows the list; an empty field is left out of the request. */
export interface ChangeLogQuery {
  range: UiChangeRange;
  area?: string;
  method?: UiChangeMethod;
  status?: UiChangeStatus;
  /** Only changes on this server connection. */
  server?: number;
  q?: string;
  page: number;
  pageSize: number;
}

const clean = <T extends object>(params: T) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== ''));

export const changeLogApi = {
  list: (query: ChangeLogQuery): Promise<UiChangeLogPage> =>
    api.get('/change-log', { params: clean(query) }).then((r) => r.data),

  areas: (): Promise<string[]> =>
    api.get('/change-log/areas').then((r) => r.data),

  getSettings: (): Promise<UiChangeLogSettingsDto> =>
    api.get('/change-log/settings').then((r) => r.data),

  setSettings: (values: {
    enabled: boolean;
    retentionDays: number;
    maxRows: number;
    recordIp: boolean;
    writeToTsLog: boolean;
  }): Promise<UiChangeLogSettingsDto> =>
    api.put('/change-log/settings', values).then((r) => r.data),

  clear: (): Promise<{ deletedCount: number }> =>
    api.delete('/change-log').then((r) => r.data),
};
