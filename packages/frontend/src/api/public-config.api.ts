import axios from 'axios';

/** The installation-wide settings a visitor can read without logging in. */
export interface PublicConfig {
  privacyNotice: { enabled: boolean };
}

// Plain axios on purpose, not the shared `api` client: this is also fetched by the
// login page and the public widget route, where there is no token to attach and no
// session to log out of.
export const publicConfigApi = {
  get: (): Promise<PublicConfig> => axios.get('/api/public-config').then((r) => r.data),
};
