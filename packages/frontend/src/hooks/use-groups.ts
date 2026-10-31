import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../api/groups.api';
import { useServerStore } from '../stores/server.store';

export function useServerGroups() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['server-groups', c, s],
    queryFn: () => groupsApi.serverGroups(c!, s!),
    enabled: !!c && !!s,
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
