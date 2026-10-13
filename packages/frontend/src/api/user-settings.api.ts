import api from './client';
import type { UserSettingKey, UserSettings } from '@ts6/common';

/** Settings stored on the signed-in user's account; every role may read and write its own. */
export const userSettingsApi = {
  get: (): Promise<UserSettings> => api.get('/user-settings').then((r) => r.data),
  set: <K extends UserSettingKey>(key: K, value: NonNullable<UserSettings[K]>) =>
    api.put(`/user-settings/${key}`, { value }).then((r) => r.data),
  reset: (key: UserSettingKey) => api.delete(`/user-settings/${key}`).then((r) => r.data),
};
