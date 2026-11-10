import type { SupportCaseEntry, SupportQueueConfig, SupportQueueConflict, SupportQueueSettings, SupportQueueView } from '@ts6/common';
import api from './client';

const base = (configId: number, sid: number) => `/servers/${configId}/vs/${sid}/support-queue`;
/** Ended cases of one queue, or of every queue of the virtual server when queueId is null. */
const historyPath = (configId: number, sid: number, queueId: number | null) =>
  queueId === null ? `${base(configId, sid)}/history` : `${base(configId, sid)}/queues/${queueId}/history`;

type QueueBody = { enabled: boolean; channelId: number; settings: SupportQueueSettings };
type Saved = { config: SupportQueueConfig; conflicts: SupportQueueConflict[] };

export const supportQueueApi = {
  /** Every queue of the virtual server with its open cases. */
  queues: (configId: number, sid: number) =>
    api.get(`${base(configId, sid)}/queues`).then((r) => r.data as SupportQueueView[]),
  history: (configId: number, sid: number, queueId: number | null, limit = 100) =>
    api.get(historyPath(configId, sid, queueId), { params: { limit } }).then((r) => r.data as SupportCaseEntry[]),
  /** Every case that ended in the last `days` days (the statistics are computed from these). */
  ended: (configId: number, sid: number, queueId: number | null, days: number) =>
    api.get(historyPath(configId, sid, queueId), { params: { days } }).then((r) => r.data as SupportCaseEntry[]),
  config: (configId: number, sid: number, queueId: number) =>
    api.get(`${base(configId, sid)}/queues/${queueId}/config`).then((r) => r.data as { config: SupportQueueConfig; conflicts: SupportQueueConflict[] }),
  create: (configId: number, sid: number, body: QueueBody) =>
    api.post(`${base(configId, sid)}/queues`, body).then((r) => r.data as Saved),
  saveConfig: (configId: number, sid: number, queueId: number, body: QueueBody) =>
    api.put(`${base(configId, sid)}/queues/${queueId}/config`, body).then((r) => r.data as Saved),
  deleteQueue: (configId: number, sid: number, queueId: number) =>
    api.delete(`${base(configId, sid)}/queues/${queueId}`),
  take: (configId: number, sid: number, id: number, supporterClid: number) =>
    api.post(`${base(configId, sid)}/cases/${id}/take`, { supporterClid }).then((r) => r.data as SupportCaseEntry),
  remove: (configId: number, sid: number, id: number) =>
    api.post(`${base(configId, sid)}/cases/${id}/remove`).then((r) => r.data as SupportCaseEntry),
  close: (configId: number, sid: number, id: number) =>
    api.post(`${base(configId, sid)}/cases/${id}/close`).then((r) => r.data as SupportCaseEntry),
};
