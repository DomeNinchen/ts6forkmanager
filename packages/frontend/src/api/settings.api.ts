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

  getDebugFlags: (): Promise<{ voice: boolean; rankCheck: boolean }> =>
    api.get('/settings/debug-flags').then((r) => r.data),

  setDebugFlag: (name: 'voice' | 'rankCheck', enabled: boolean) =>
    api.put(`/settings/debug-flags/${name}`, { enabled }).then((r) => r.data),

  resetRadioStationIds: (): Promise<{ deletedCount: number }> =>
    api.post('/settings/reset-radio-station-ids').then((r) => r.data),

  resetMusicBotIds: (): Promise<{ deletedCount: number }> =>
    api.post('/settings/reset-music-bot-ids').then((r) => r.data),

  getScheduledRestart: (): Promise<ScheduledRestartConfig> =>
    api.get('/settings/scheduled-restart').then((r) => r.data),

  setScheduledRestart: (config: ScheduledRestartConfig): Promise<ScheduledRestartConfig> =>
    api.put('/settings/scheduled-restart', config).then((r) => r.data),
};

export interface ScheduledRestartConfig {
  backendEnabled: boolean;
  sidecarEnabled: boolean;
  time: string;
  days: number[];
}
