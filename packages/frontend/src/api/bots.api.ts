import type { CustomRoleKey, UserPermission, UserRole } from '@ts6/common';
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

export interface FixedRoleSetup { role: UserRole; permissions: UserPermission[]; defaults: UserPermission[]; changed: boolean; users: string[] }
export interface CustomRoleSetup { id: number; role: CustomRoleKey; name: string; permissions: UserPermission[]; users: string[] }

/** The roles as the admin set them up (admin only). */
export const rolesApi = {
  list: (): Promise<{ fixed: FixedRoleSetup[]; custom: CustomRoleSetup[] }> => api.get('/roles').then((r) => r.data),
  setFixed: (role: UserRole, permissions: UserPermission[]) => api.put(`/roles/fixed/${role}`, { permissions }),
  resetFixed: (role: UserRole) => api.delete(`/roles/fixed/${role}`),
  createCustom: (name: string, permissions: UserPermission[]): Promise<{ id: number; role: CustomRoleKey }> =>
    api.post('/roles/custom', { name, permissions }).then((r) => r.data),
  updateCustom: (id: number, name: string, permissions: UserPermission[]) => api.put(`/roles/custom/${id}`, { name, permissions }),
  deleteCustom: (id: number) => api.delete(`/roles/custom/${id}`),
};

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
