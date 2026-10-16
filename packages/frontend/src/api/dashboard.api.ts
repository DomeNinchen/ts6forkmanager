import api from './client';
import type { UserHistoryResponse } from './statistics.api';
import type { OnlineCountFilter, OnlineCountScope } from '@ts6/common';

export const dashboardApi = {
  /** The last 24 hours of the recorded user count; open to every role with access to the server. */
  userHistory: (configId: number, sid: number): Promise<UserHistoryResponse> =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard/user-history`).then((r) => r.data),
  get: (configId: number, sid: number) =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard`).then((r) => r.data),
  bandwidthHistory: (configId: number, sid: number) =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard/bandwidth-history`).then((r) => r.data),
  /** Admin-only: who the online-users number leaves out, for the dashboard or the embed widgets. */
  getOnlineFilter: (configId: number, sid: number, scope: OnlineCountScope): Promise<OnlineCountFilter> =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard/online-filter`, { params: { scope } }).then((r) => r.data),
  setOnlineFilter: (configId: number, sid: number, scope: OnlineCountScope, filter: OnlineCountFilter): Promise<OnlineCountFilter> =>
    api.put(`/servers/${configId}/vs/${sid}/dashboard/online-filter`, filter, { params: { scope } }).then((r) => r.data),
};
