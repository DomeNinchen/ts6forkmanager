import api from './client';

export interface YtCookieCheckResult {
  valid: boolean | null;
  checkedAt: string | null;
}

export const ytCookieCheckApi = {
  get: (): Promise<YtCookieCheckResult> => api.get('/yt-cookie-check').then((r) => r.data),
  recheck: (): Promise<YtCookieCheckResult> => api.post('/yt-cookie-check/recheck').then((r) => r.data),
};
