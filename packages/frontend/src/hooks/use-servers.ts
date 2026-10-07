import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../api/servers.api';
import { useServerStore } from '../stores/server.store';

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: serversApi.list,
  });
}

/**
 * What the connection a server list entry describes can do. A connection without
 * an API key has no WebQuery (only the music bots and what runs over the voice
 * connection work on it); one without an SSH login has no live events for bot
 * flows. A flag the backend did not send (an older backend) counts as "can", and
 * so does an entry that is not there (yet), so nothing flickers away while the
 * list loads.
 */
export function serverCapabilities(server: any | undefined) {
  return {
    hasWebQuery: server ? server.hasWebQuery !== false : true,
    hasSsh: server ? !!server.hasSshCredentials : true,
  };
}

/**
 * The connection chosen in the header, with what it can do - what the sidebar and the route guards hide pages by.
 * `loaded` is false until the server list has arrived: until then nothing is known about the connection, and
 * whatever asks WebQuery on its behalf has to wait (after a reload the chosen connection is remembered, the list is not).
 */
export function useSelectedServer() {
  const { selectedConfigId } = useServerStore();
  const { data: servers, isPending } = useServers();
  const server = Array.isArray(servers) ? servers.find((s: any) => s.id === selectedConfigId) : undefined;
  return { server, loaded: !isPending, ...serverCapabilities(server) };
}

export function useVirtualServers() {
  const { selectedConfigId } = useServerStore();
  // The virtual server list is a WebQuery call: a connection without one has nothing to list.
  const { hasWebQuery, loaded } = useSelectedServer();
  return useQuery({
    queryKey: ['virtual-servers', selectedConfigId],
    queryFn: () => serversApi.listVirtual(selectedConfigId!),
    enabled: !!selectedConfigId && loaded && hasWebQuery,
  });
}

export function useVirtualServerInfo() {
  const { selectedConfigId, selectedSid } = useServerStore();
  return useQuery({
    queryKey: ['virtual-server-info', selectedConfigId, selectedSid],
    queryFn: () => serversApi.getVirtualInfo(selectedConfigId!, selectedSid!),
    enabled: !!selectedConfigId && !!selectedSid,
  });
}

export function useEditVirtualServer() {
  const qc = useQueryClient();
  const { selectedConfigId, selectedSid } = useServerStore();
  return useMutation({
    mutationFn: (data: any) => serversApi.editVirtual(selectedConfigId!, selectedSid!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['virtual-server-info', selectedConfigId, selectedSid] }),
  });
}

export function useHostInfo() {
  const { selectedConfigId } = useServerStore();
  return useQuery({
    queryKey: ['host-info-stats', selectedConfigId],
    queryFn: () => serversApi.hostInfo(selectedConfigId!),
    enabled: !!selectedConfigId,
    refetchInterval: 10_000,
  });
}

export function useConnectionInfo() {
  const { selectedConfigId, selectedSid } = useServerStore();
  return useQuery({
    queryKey: ['connection-info', selectedConfigId, selectedSid],
    queryFn: () => serversApi.getConnectionInfo(selectedConfigId!, selectedSid!),
    enabled: !!selectedConfigId && !!selectedSid,
    refetchInterval: 10_000,
  });
}

export function useCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => serversApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }),
  });
}

export function useCreateVirtualServer() {
  const qc = useQueryClient();
  const { selectedConfigId } = useServerStore();
  return useMutation({
    mutationFn: (data: any) => serversApi.createVirtual(selectedConfigId!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['virtual-servers', selectedConfigId] }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (id: number) => serversApi.test(id),
  });
}
