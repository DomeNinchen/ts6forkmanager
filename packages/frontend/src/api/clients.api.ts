import api from './client';

const base = (configId: number, sid: number) =>
  `/servers/${configId}/vs/${sid}/clients`;

export const clientsApi = {
  list: (configId: number, sid: number) =>
    api.get(base(configId, sid)).then((r) => r.data),
  get: (configId: number, sid: number, clid: number) =>
    api.get(`${base(configId, sid)}/${clid}`).then((r) => r.data),
  database: (configId: number, sid: number, start = 0, duration = 100) =>
    api.get(`${base(configId, sid)}/database`, { params: { start, duration } }).then((r) => r.data),
  kick: (configId: number, sid: number, clid: number, reasonid: number, reasonmsg?: string) =>
    api.post(`${base(configId, sid)}/${clid}/kick`, { reasonid, reasonmsg }).then((r) => r.data),
  ban: (configId: number, sid: number, clid: number, time?: number, banreason?: string) =>
    api.post(`${base(configId, sid)}/${clid}/ban`, { time, banreason }).then((r) => r.data),
  move: (configId: number, sid: number, clid: number, cid: number) =>
    api.post(`${base(configId, sid)}/${clid}/move`, { cid }).then((r) => r.data),
  poke: (configId: number, sid: number, clid: number, msg: string) =>
    api.post(`${base(configId, sid)}/${clid}/poke`, { msg }).then((r) => r.data),
  message: (configId: number, sid: number, clid: number, msg: string) =>
    api.post(`${base(configId, sid)}/${clid}/message`, { msg }).then((r) => r.data),

  // Bulk actions on multiple selected clients at once
  bulkMove: (configId: number, sid: number, clids: number[], cid: number) =>
    api.post(`${base(configId, sid)}/bulk/move`, { clids, cid }).then((r) => r.data),
  bulkKick: (configId: number, sid: number, clids: number[], reasonid: number, reasonmsg?: string) =>
    api.post(`${base(configId, sid)}/bulk/kick`, { clids, reasonid, reasonmsg }).then((r) => r.data),
  bulkBan: (configId: number, sid: number, clids: number[], time?: number, banreason?: string) =>
    api.post(`${base(configId, sid)}/bulk/ban`, { clids, time, banreason }).then((r) => r.data),
  bulkDescribe: (configId: number, sid: number, clids: number[], description: string) =>
    api.post(`${base(configId, sid)}/bulk/describe`, { clids, description }).then((r) => r.data),
};
