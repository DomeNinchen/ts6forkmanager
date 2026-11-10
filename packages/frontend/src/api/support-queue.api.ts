import type { SupportCaseEntry, SupportQueueConfig, SupportQueueConflict, SupportQueueSettings, SupportQueueView } from '@ts6/common';
import api from './client';

const base = (configId: number, sid: number) => `/servers/${configId}/vs/${sid}/support-queue`;

export const supportQueueApi = {
  view: (configId: number, sid: number) =>
    api.get(base(configId, sid)).then((r) => r.data as SupportQueueView),
  history: (configId: number, sid: number, limit = 100) =>
    api.get(`${base(configId, sid)}/history`, { params: { limit } }).then((r) => r.data as SupportCaseEntry[]),
  /** Every case that ended in the last `days` days (the statistics are computed from these). */
  ended: (configId: number, sid: number, days: number) =>
    api.get(`${base(configId, sid)}/history`, { params: { days } }).then((r) => r.data as SupportCaseEntry[]),
  config: (configId: number, sid: number) =>
    api.get(`${base(configId, sid)}/config`).then((r) => r.data as { config: SupportQueueConfig; defaults: SupportQueueSettings; conflicts: SupportQueueConflict[] }),
  saveConfig: (configId: number, sid: number, body: { enabled: boolean; channelId: number; settings: SupportQueueSettings }) =>
    api.put(`${base(configId, sid)}/config`, body).then((r) => r.data as { config: SupportQueueConfig; conflicts: SupportQueueConflict[] }),
  take: (configId: number, sid: number, id: number, supporterClid: number) =>
    api.post(`${base(configId, sid)}/cases/${id}/take`, { supporterClid }).then((r) => r.data as SupportCaseEntry),
  remove: (configId: number, sid: number, id: number) =>
    api.post(`${base(configId, sid)}/cases/${id}/remove`).then((r) => r.data as SupportCaseEntry),
  close: (configId: number, sid: number, id: number) =>
    api.post(`${base(configId, sid)}/cases/${id}/close`).then((r) => r.data as SupportCaseEntry),
};
