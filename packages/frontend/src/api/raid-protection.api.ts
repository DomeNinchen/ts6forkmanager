import type { RaidIncidentEntry, RaidProtectionView, RaidSettings } from '@ts6/common';
import api from './client';

const base = (configId: number, sid: number) => `/servers/${configId}/vs/${sid}/raid-protection`;

export const raidProtectionApi = {
  view: (configId: number, sid: number) => api.get(base(configId, sid)).then((r) => r.data as RaidProtectionView),
  save: (configId: number, sid: number, body: { enabled: boolean; settings: RaidSettings }) =>
    api.put(base(configId, sid), body).then((r) => r.data as RaidProtectionView),
  setActing: (configId: number, sid: number, body: { acting: boolean; confirmObserve?: boolean }) =>
    api.post(`${base(configId, sid)}/acting`, body).then((r) => r.data as RaidProtectionView),
  stop: (configId: number, sid: number) => api.post(`${base(configId, sid)}/stop`).then((r) => r.data as RaidProtectionView),
  incidents: (configId: number, sid: number, limit = 50) =>
    api.get(`${base(configId, sid)}/incidents`, { params: { limit } }).then((r) => r.data as RaidIncidentEntry[]),
};
