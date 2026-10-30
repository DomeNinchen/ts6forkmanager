import api from './client';

export const botsApi = {
  list: () => api.get('/bots').then((r) => r.data),
  get: (id: number) => api.get(`/bots/${id}`).then((r) => r.data),
  create: (data: any) => api.post('/bots', data).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/bots/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/bots/${id}`),
  enable: (id: number) => api.post(`/bots/${id}/enable`).then((r) => r.data),
  disable: (id: number) => api.post(`/bots/${id}/disable`).then((r) => r.data),
  executions: (id: number) => api.get(`/bots/${id}/executions`).then((r) => r.data),
  executionLogs: (botId: number, execId: number) =>
    api.get(`/bots/${botId}/executions/${execId}/logs`).then((r) => r.data),
};

export interface UserSession {
  id: number;
  createdAt: string;
  expiresAt: string;
}

export const usersApi = {
  list: () => api.get('/users').then((r) => r.data),
  create: (data: any) => api.post('/users', data).then((r) => r.data),
  update: (id: number, data: any) => api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  getServerAccess: (id: number): Promise<{ serverConfigIds: number[]; grants: { serverConfigId: number; allVirtualServers: boolean; sids: number[] }[] }> =>
    api.get(`/users/${id}/server-access`).then((r) => r.data),
  /** Per connection the virtual servers the account may use (ignored for a connection without WebQuery, which is granted whole). */
  setServerAccess: (id: number, grants: { serverConfigId: number; sids: number[] }[]) => api.put(`/users/${id}/server-access`, { grants }),
  /** Per server connection, how many server groups are marked protected (any virtual server). */
  protectedGroups: (): Promise<{ serverConfigId: number; count: number }[]> => api.get('/users/protected-groups').then((r) => r.data),
  getSessions: (id: number): Promise<UserSession[]> => api.get(`/users/${id}/sessions`).then((r) => r.data),
  revokeSession: (id: number, sessionId: number) => api.delete(`/users/${id}/sessions/${sessionId}`),
  revokeAllSessions: (id: number): Promise<{ revoked: number }> => api.delete(`/users/${id}/sessions`).then((r) => r.data),
};
