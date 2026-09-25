import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { commandPermissionsApi } from '../api/command-permissions.api';

export function useCommandPermissions(configId: number | null) {
  return useQuery({
    queryKey: ['command-permissions', configId],
    queryFn: () => commandPermissionsApi.list(configId!),
    enabled: !!configId,
  });
}

export function useSetCommandPermission(configId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ command, allowedGroupIds }: { command: string; allowedGroupIds: string }) =>
      commandPermissionsApi.setCommand(configId!, command, allowedGroupIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['command-permissions', configId] }),
  });
}

export function useClearCommandPermission(configId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (command: string) => commandPermissionsApi.clearCommand(configId!, command),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['command-permissions', configId] }),
  });
}

export function useSetAdminGroups(configId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupIds: string[]) => commandPermissionsApi.setAdminGroups(configId!, groupIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['command-permissions', configId] }),
  });
}
