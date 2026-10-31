import type {
  BulkResult,
  ClientDbBanRequest,
  ClientDbBanResult,
  ClientDbDeleteResult,
  ClientDbDetails,
  ClientDbGroupsOverview,
  ClientDbListPage,
  ClientDbSearchParams,
  ClientDbSearchResult,
} from '@ts6/common';
import api from './client';

const base = (configId: number, sid: number) =>
  `/servers/${configId}/vs/${sid}/clients/database`;

export const clientDatabaseApi = {
  /** One block of the listing; `offset` counts the newest profiles already loaded. */
  list: (configId: number, sid: number, offset: number, limit: number): Promise<ClientDbListPage> =>
    api.get(`${base(configId, sid)}/list`, { params: { offset, limit } }).then((r) => r.data),
  search: (configId: number, sid: number, params: ClientDbSearchParams): Promise<ClientDbSearchResult> =>
    api.get(`${base(configId, sid)}/search`, { params }).then((r) => r.data),
  details: (configId: number, sid: number, cldbid: number): Promise<ClientDbDetails> =>
    api.get(`${base(configId, sid)}/${cldbid}/details`).then((r) => r.data),
  /** The server groups whose membership can be changed here, with the members of each (group mode). */
  groups: (configId: number, sid: number): Promise<ClientDbGroupsOverview> =>
    api.get(`${base(configId, sid)}/groups`).then((r) => r.data),
  ban: (configId: number, sid: number, request: ClientDbBanRequest): Promise<ClientDbBanResult> =>
    api.post(`${base(configId, sid)}/ban`, request).then((r) => r.data),
  remove: (configId: number, sid: number, cldbids: number[]): Promise<ClientDbDeleteResult> =>
    api.post(`${base(configId, sid)}/delete`, { cldbids }).then((r) => r.data),
  /** Previews (R9): same routes and checks, nothing runs; the answer is one bulk outcome per target. */
  banPreview: (configId: number, sid: number, request: ClientDbBanRequest): Promise<BulkResult> =>
    api.post(`${base(configId, sid)}/ban`, { ...request, dryRun: true }).then((r) => r.data),
  removePreview: (configId: number, sid: number, cldbids: number[]): Promise<BulkResult> =>
    api.post(`${base(configId, sid)}/delete`, { cldbids, dryRun: true }).then((r) => r.data),
};
