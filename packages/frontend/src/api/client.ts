import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

/**
 * A fresh access token in place of `used`, or null when the login is over. A refresh token works
 * once, and the backend ends the whole login when a used one comes back - so the requests of a
 * page that all got a 401 together share one refresh, and the tabs of the browser take turns
 * (Web Locks; only available on https or localhost). A tab whose turn comes after another one
 * refreshed finds the new tokens in storage and takes those instead of sending its own used one.
 */
function freshAccessToken(used: string | undefined): Promise<string | null> {
  refreshing ??= (async () => {
    const renew = async (): Promise<string | null> => {
      await useAuthStore.persist.rehydrate();
      const { accessToken, refreshToken, setTokens, logout } = useAuthStore.getState();
      if (accessToken && accessToken !== used) return accessToken;
      if (!refreshToken) {
        logout();
        return null;
      }
      try {
        const res = await axios.post('/api/auth/refresh', { refreshToken });
        setTokens(res.data.accessToken, res.data.refreshToken);
        return res.data.accessToken;
      } catch (err) {
        // Only a refusal ends the login here; a backend that is restarting does not
        if (axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 400)) logout();
        return null;
      }
    };
    try {
      return 'locks' in navigator ? await navigator.locks.request('ts6-auth-refresh', renew) : await renew();
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const sent = String(original.headers.Authorization ?? '').replace(/^Bearer /, '') || undefined;
      const token = await freshAccessToken(sent);
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export default api;
