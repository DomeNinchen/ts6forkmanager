import type {
  BanCheck,
  ConnectionJournalCountry,
  ConnectionJournalGeoIpStatus,
  ConnectionJournalIpPage,
  ConnectionJournalPage,
  ConnectionJournalSettingsDto,
  ConnectionJournalTsStatus,
  CreateTsBanRequest,
  CreateWebBanRequest,
  GeoIpEdition,
  JournalEvent,
  JournalIpSortColumn,
  JournalRange,
  JournalResult,
  JournalSortColumn,
  JournalSource,
  TsBanResult,
  WebIpBanDto,
  WebIpBanList,
} from '@ts6/common';
import api from './client';

/** What narrows the list; an empty field is left out of the request. */
export interface JournalQuery {
  range: JournalRange;
  source?: JournalSource;
  event?: JournalEvent;
  result?: JournalResult;
  q?: string;
  ip?: string;
  /** Only TeamSpeak clients that are on the server right now. */
  online?: boolean;
  /** Only TeamSpeak sessions on this server connection. */
  server?: number;
  /** Only addresses in this country (ISO 3166-1 alpha-2). */
  country?: string;
  page: number;
  pageSize: number;
}

const clean = <T extends object>(params: T) =>
  Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== '' && value !== false)
      // The one boolean on the wire is `online=1`.
      .map(([key, value]) => [key, value === true ? '1' : value]),
  );

export const connectionJournalApi = {
  list: (query: JournalQuery & { sort: JournalSortColumn; order: 'asc' | 'desc' }): Promise<ConnectionJournalPage> =>
    api.get('/connection-journal', { params: clean(query) }).then((r) => r.data),

  byIp: (query: JournalQuery & { sort: JournalIpSortColumn; order: 'asc' | 'desc' }): Promise<ConnectionJournalIpPage> =>
    api.get('/connection-journal/by-ip', { params: clean(query) }).then((r) => r.data),

  getSettings: (): Promise<ConnectionJournalSettingsDto> =>
    api.get('/connection-journal/settings').then((r) => r.data),

  setSettings: (values: {
    enabled: boolean;
    retentionDays: number;
    maxRows: number;
    recordQueryClients: boolean;
    recordOwnBots: boolean;
  }): Promise<ConnectionJournalSettingsDto> =>
    api.put('/connection-journal/settings', values).then((r) => r.data),

  getTsStatus: (): Promise<ConnectionJournalTsStatus[]> =>
    api.get('/connection-journal/ts-status').then((r) => r.data),

  clear: (): Promise<{ deletedCount: number }> =>
    api.delete('/connection-journal').then((r) => r.data),

  countries: (): Promise<ConnectionJournalCountry[]> =>
    api.get('/connection-journal/countries').then((r) => r.data),

  // --- the GeoIP database behind the country column ---
  getGeoIp: (): Promise<ConnectionJournalGeoIpStatus> =>
    api.get('/connection-journal/geoip').then((r) => r.data),

  setGeoIpSettings: (values: { edition: GeoIpEdition; autoUpdate: boolean }): Promise<ConnectionJournalGeoIpStatus> =>
    api.put('/connection-journal/geoip/settings', values).then((r) => r.data),

  /** Starts the download; it runs on the server and the status shows how far it is. */
  downloadGeoIp: (edition?: GeoIpEdition): Promise<ConnectionJournalGeoIpStatus> =>
    api.post('/connection-journal/geoip/download', edition ? { edition } : {}).then((r) => r.data),

  uploadGeoIp: (file: File): Promise<ConnectionJournalGeoIpStatus> => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/connection-journal/geoip/upload', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 }).then((r) => r.data);
  },

  removeGeoIp: (): Promise<ConnectionJournalGeoIpStatus> =>
    api.delete('/connection-journal/geoip').then((r) => r.data),

  // --- bans: the web interface turning an address away, and a ban on a TeamSpeak server ---
  bans: (): Promise<WebIpBanList> =>
    api.get('/connection-journal/bans').then((r) => r.data),

  /** What stands between this address and a ban (own address, private network, an admin's address, the emergency switch). */
  banCheck: (ip: string): Promise<BanCheck> =>
    api.get('/connection-journal/bans/check', { params: { ip } }).then((r) => r.data),

  createWebBan: (request: CreateWebBanRequest): Promise<WebIpBanDto> =>
    api.post('/connection-journal/bans', request).then((r) => r.data),

  removeWebBan: (id: number): Promise<{ success: boolean }> =>
    api.delete(`/connection-journal/bans/${id}`).then((r) => r.data),

  createTsBan: (request: CreateTsBanRequest): Promise<TsBanResult> =>
    api.post('/connection-journal/bans/ts', request).then((r) => r.data),
};
