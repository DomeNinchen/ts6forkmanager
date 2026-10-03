import type {
  ConsoleAuditPage,
  ConsoleAuditStatus,
  ConsoleExecuteRequest,
  ConsoleExecuteResponse,
  ConsoleSettings,
} from '@ts6/common';
import api from './client';

export interface ConsoleLogQuery {
  before?: number;
  limit?: number;
  status?: ConsoleAuditStatus;
  dangerOnly?: boolean;
  thisServer?: boolean;
  search?: string;
}

export const consoleApi = {
  execute: (configId: number, request: ConsoleExecuteRequest) =>
    api.post<ConsoleExecuteResponse>(`/servers/${configId}/console/execute`, request).then((r) => r.data),

  log: (configId: number, query: ConsoleLogQuery) =>
    api
      .get<ConsoleAuditPage>(`/servers/${configId}/console/log`, {
        params: {
          before: query.before,
          limit: query.limit,
          status: query.status,
          dangerOnly: query.dangerOnly ? 1 : undefined,
          thisServer: query.thisServer ? 1 : undefined,
          search: query.search || undefined,
        },
      })
      .then((r) => r.data),

  getSettings: () => api.get<ConsoleSettings>('/settings/console').then((r) => r.data),
  saveSettings: (settings: ConsoleSettings) => api.put<ConsoleSettings>('/settings/console', settings).then((r) => r.data),
};
