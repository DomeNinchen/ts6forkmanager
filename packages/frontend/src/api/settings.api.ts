import api from './client';

export const settingsApi = {
  getYtCookieStatus: () => api.get('/settings/yt-cookies').then((r) => r.data),

  uploadYtCookieFile: (file: File) => {
    const formData = new FormData();
    formData.append('cookies', file);
    return api.post('/settings/yt-cookies', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  uploadYtCookieText: (text: string) =>
    api.post('/settings/yt-cookies', { text }).then((r) => r.data),

  deleteYtCookies: () => api.delete('/settings/yt-cookies').then((r) => r.data),

  getDebugFlags: (): Promise<{ voice: boolean; rankCheck: boolean; query: boolean }> =>
    api.get('/settings/debug-flags').then((r) => r.data),

  setDebugFlag: (name: 'voice' | 'rankCheck' | 'query', enabled: boolean) =>
    api.put(`/settings/debug-flags/${name}`, { enabled }).then((r) => r.data),

  resetRadioStationIds: (): Promise<{ deletedCount: number }> =>
    api.post('/settings/reset-radio-station-ids').then((r) => r.data),

  resetMusicBotIds: (): Promise<{ deletedCount: number }> =>
    api.post('/settings/reset-music-bot-ids').then((r) => r.data),

  getScheduledRestart: (): Promise<ScheduledRestartConfig> =>
    api.get('/settings/scheduled-restart').then((r) => r.data),

  setScheduledRestart: (config: ScheduledRestartConfig): Promise<ScheduledRestartConfig> =>
    api.put('/settings/scheduled-restart', config).then((r) => r.data),

  getOidc: (): Promise<OidcSettings> =>
    api.get('/settings/oidc').then((r) => r.data),

  setOidc: (config: OidcSettingsInput): Promise<OidcSettings> =>
    api.put('/settings/oidc', config).then((r) => r.data),

  getMusicCacheSettings: (): Promise<MusicCacheSettings> =>
    api.get('/settings/music-cache').then((r) => r.data),

  setMusicCacheSettings: (config: MusicCacheSettings): Promise<MusicCacheSettings> =>
    api.put('/settings/music-cache', config).then((r) => r.data),

  getWebguiTheme: (): Promise<{ preset: AccentPreset }> =>
    api.get('/settings/webgui-theme').then((r) => r.data),

  setWebguiTheme: (preset: AccentPreset): Promise<{ preset: AccentPreset }> =>
    api.put('/settings/webgui-theme', { preset }).then((r) => r.data),

  getWebguiBaseTheme: (): Promise<{ theme: BaseTheme }> =>
    api.get('/settings/webgui-base-theme').then((r) => r.data),

  setWebguiBaseTheme: (theme: BaseTheme): Promise<{ theme: BaseTheme }> =>
    api.put('/settings/webgui-base-theme', { theme }).then((r) => r.data),
};

export type AccentPreset = 'violet' | 'teal' | 'red' | 'blue' | 'yellow' | 'green';
/** The structural background/surface palette - independent of (and combinable with) the accent preset above. */
export type BaseTheme = 'command-deck' | 'oled';

export interface OidcSettings {
  enabled: boolean;
  issuer: string;
  clientId: string;
  buttonLabel: string;
  hasClientSecret: boolean;
}

export interface OidcSettingsInput {
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** Empty string means "keep the existing secret unchanged". */
  clientSecret: string;
  buttonLabel: string;
}

export interface MusicCacheSettings {
  keepPlayedSongs: boolean;
}

export interface ScheduledRestartConfig {
  backendEnabled: boolean;
  sidecarEnabled: boolean;
  time: string;
  days: number[];
}
