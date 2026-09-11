import api from './client';

export const dashboardApi = {
  get: (configId: number, sid: number) =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard`).then((r) => r.data),
  bandwidthHistory: (configId: number, sid: number) =>
    api.get(`/servers/${configId}/vs/${sid}/dashboard/bandwidth-history`).then((r) => r.data),
};
