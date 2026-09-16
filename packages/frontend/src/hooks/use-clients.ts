import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '../api/clients.api';
import { useServerStore } from '../stores/server.store';

export function useClients() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['clients', c, s],
    queryFn: () => clientsApi.list(c!, s!),
    enabled: !!c && !!s,
    refetchInterval: 10000,
  });
}

export function useClientDatabase() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['client-database', c, s],
    queryFn: () => clientsApi.database(c!, s!),
    enabled: !!c && !!s,
  });
}

export function useKickClient() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ clid, reasonid, reasonmsg }: { clid: number; reasonid: number; reasonmsg?: string }) =>
      clientsApi.kick(c!, s!, clid, reasonid, reasonmsg),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useBanClient() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ clid, time, banreason }: { clid: number; time?: number; banreason?: string }) =>
      clientsApi.ban(c!, s!, clid, time, banreason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useMoveClient() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ clid, cid }: { clid: number; cid: number }) =>
      clientsApi.move(c!, s!, clid, cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useBulkMoveClients() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ clids, cid }: { clids: number[]; cid: number }) =>
      clientsApi.bulkMove(c!, s!, clids, cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useBulkKickClients() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ clids, reasonid, reasonmsg }: { clids: number[]; reasonid: number; reasonmsg?: string }) =>
      clientsApi.bulkKick(c!, s!, clids, reasonid, reasonmsg),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useBulkBanClients() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ clids, time, banreason }: { clids: number[]; time?: number; banreason?: string }) =>
      clientsApi.bulkBan(c!, s!, clids, time, banreason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useBulkDescribeClients() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ clids, description }: { clids: number[]; description: string }) =>
      clientsApi.bulkDescribe(c!, s!, clids, description),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function usePokeClient() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: ({ clid, msg }: { clid: number; msg: string }) =>
      clientsApi.poke(c!, s!, clid, msg),
  });
}
