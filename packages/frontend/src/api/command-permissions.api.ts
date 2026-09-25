import api from './client';
import type { CommandPermissionsResponse } from '@ts6/common';

const base = (configId: number) => `/servers/${configId}/command-permissions`;

export const commandPermissionsApi = {
  list: (configId: number) =>
    api.get<CommandPermissionsResponse>(base(configId)).then((r) => r.data),
  setCommand: (configId: number, command: string, allowedGroupIds: string) =>
    api.put(`${base(configId)}/${command}`, { allowedGroupIds }).then((r) => r.data),
  clearCommand: (configId: number, command: string) =>
    api.delete(`${base(configId)}/${command}`),
  setAdminGroups: (configId: number, groupIds: string[]) =>
    api.put(`${base(configId)}/admin-groups`, { groupIds }).then((r) => r.data),
};
