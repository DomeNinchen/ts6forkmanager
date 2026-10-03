import api from './client';
import type { UserHistoryResponse } from './statistics.api';

export const dashboardApi = {
  /** The last 24 hours of the recorded user count; open to every role with access to the server. */
  userHistory: (configId: number, sid: number): Promise<UserHistoryResponse> =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard/user-history`).then((r) => r.data),
  get: (configId: number, sid: number) =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard`).then((r) => r.data),
  bandwidthHistory: (configId: number, sid: number) =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard/bandwidth-history`).then((r) => r.data),
};
