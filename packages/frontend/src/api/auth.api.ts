import api from './client';

export const authApi = {
  login: (username: string, password: string, deviceToken?: string) =>
    api.post('/auth/login', { username, password, deviceToken }).then((r) => r.data),

  verifyTotp: (ticket: string, code: string, rememberDevice: boolean) =>
    api.post('/auth/login/verify-totp', { ticket, code, rememberDevice }).then((r) => r.data),

  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }).then((r) => r.data),

  logout: (refreshToken: string) =>
    api.post('/auth/logout', { refreshToken }),

  me: () => api.get('/auth/me').then((r) => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/auth/password', { currentPassword, newPassword }),

  oidcStatus: (): Promise<{ enabled: boolean; buttonLabel: string }> =>
    api.get('/auth/oidc/status').then((r) => r.data),

  totpSetup: (): Promise<{ secret: string; qrCodeDataUrl: string }> =>
    api.post('/auth/totp/setup').then((r) => r.data),

  totpVerifySetup: (code: string): Promise<{ recoveryCodes: string[] }> =>
    api.post('/auth/totp/verify-setup', { code }).then((r) => r.data),

  totpDisable: (password: string) =>
    api.post('/auth/totp/disable', { password }),
};
