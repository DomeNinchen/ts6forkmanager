import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../api/groups.api';
import { useServerStore } from '../stores/server.store';

/** Temporary memberships of the selected virtual server (R13). The job ends them within 30 s, so the list refreshes every 30 s. */
export function useTemporaryGroups(scope: 'open' | 'history' = 'open', enabled = true) {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['temporary-groups', c, s, scope],
    queryFn: () => groupsApi.temporaryGroups(c!, s!, scope),
    enabled: !!c && !!s && enabled,
    refetchInterval: 30_000,
  });
}

/** One mutation for every temporary-membership action; each refreshes the lists and the group member lists. */
export function useTemporaryGroupAction<A, R>(run: (c: number, s: number, args: A) => Promise<R>) {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: (args: A) => run(c!, s!, args),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['temporary-groups', c, s] });
      // All of them: the page keys a group's members by the sgid string TeamSpeak hands out.
      qc.invalidateQueries({ queryKey: ['server-group-members', c, s] });
    },
  });
}

export function useServerGroups(enabled = true) {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['server-groups', c, s],
    queryFn: () => groupsApi.serverGroups(c!, s!),
    enabled: !!c && !!s && enabled,
  });
}

export function useChannelGroups() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['channel-groups', c, s],
    queryFn: () => groupsApi.channelGroups(c!, s!),
    enabled: !!c && !!s,
  });
}

export function useCreateChannelGroup() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: (name: string) => groupsApi.createChannelGroup(c!, s!, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channel-groups'] }),
  });
}

export function useDeleteChannelGroup() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ cgid, skipBackup }: { cgid: number; skipBackup?: boolean }) => groupsApi.deleteChannelGroup(c!, s!, cgid, skipBackup),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channel-groups'] }),
  });
}

export function useServerGroupMembers(sgid: number | null) {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['server-group-members', c, s, sgid],
    queryFn: () => groupsApi.serverGroupMembers(c!, s!, sgid!),
    enabled: !!c && !!s && !!sgid,
  });
}

export function useCreateServerGroup() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: (name: string) => groupsApi.createServerGroup(c!, s!, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-groups'] }),
  });
}

export function useDeleteServerGroup() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ sgid, skipBackup }: { sgid: number; skipBackup?: boolean }) => groupsApi.deleteServerGroup(c!, s!, sgid, skipBackup),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-groups'] }),
  });
}

export function useAddServerGroupMember() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ sgid, cldbid }: { sgid: number; cldbid: number }) =>
      groupsApi.addServerGroupMember(c!, s!, sgid, cldbid),
    onSuccess: (_, { sgid }) => qc.invalidateQueries({ queryKey: ['server-group-members', c, s, sgid] }),
  });
}

export function useRemoveServerGroupMember() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ sgid, cldbid }: { sgid: number; cldbid: number }) =>
      groupsApi.removeServerGroupMember(c!, s!, sgid, cldbid),
    onSuccess: (_, { sgid }) => qc.invalidateQueries({ queryKey: ['server-group-members', c, s, sgid] }),
  });
}
