import { useQuery } from '@tanstack/react-query';
import { permissionsApi } from '@/api/permissions.api';
import { serversApi } from '@/api/servers.api';

// The things on a TeamSpeak server that ServerQuery names by number - channels,
// clients, groups, virtual servers, permissions - and the lists the console
// fetches to show them by name: for picking a value (Ctrl+Space) and for
// explaining one in a result.

export type EntityKind =
  | 'channel'
  | 'client'
  | 'clientDb'
  | 'serverGroup'
  | 'channelGroup'
  | 'virtualServer'
  | 'permission';

/**
 * Which kind of thing a parameter or a result field holds an id of, by name.
 * Commands and their results use the same names (`cid` goes in and comes out),
 * so one table serves both directions.
 */
const ENTITY_OF_FIELD: Readonly<Record<string, EntityKind>> = {
  cid: 'channel',
  pid: 'channel',
  cpid: 'channel',
  tcid: 'channel',
  tokenid2: 'channel',
  client_channel_id: 'channel',

  clid: 'client',
  client_id: 'client',
  invokerid: 'client',

  cldbid: 'clientDb',
  tcldbid: 'clientDb',
  fcldbid: 'clientDb',
  client_database_id: 'clientDb',
  invokerdbid: 'clientDb',

  sgid: 'serverGroup',
  ssgid: 'serverGroup',
  tsgid: 'serverGroup',
  client_servergroups: 'serverGroup',

  cgid: 'channelGroup',
  scgid: 'channelGroup',
  tcgid: 'channelGroup',
  client_channel_group_id: 'channelGroup',

  sid: 'virtualServer',
  virtualserver_id: 'virtualServer',

  permsid: 'permission',
  permid: 'permission',
};

/** Field names come from the server, so look them up as own keys only: a field called "constructor" is no id. */
export function entityOfField(field: string): EntityKind | undefined {
  return Object.prototype.hasOwnProperty.call(ENTITY_OF_FIELD, field) ? ENTITY_OF_FIELD[field] : undefined;
}

export interface EntityItem {
  /** The id as ServerQuery writes it (for `permsid`: the permission's name). */
  id: string;
  name: string;
  /** A second piece of text worth searching and showing, e.g. a virtual server's port. */
  detail?: string;
}

const rows = (value: unknown): Record<string, string>[] => (Array.isArray(value) ? value : value ? [value as Record<string, string>] : []);

async function fetchEntities(kind: EntityKind, configId: number, sid: number): Promise<EntityItem[]> {
  switch (kind) {
    case 'channel':
      return rows(await permissionsApi.channels(configId, sid)).map((row) => ({ id: row.cid, name: row.channel_name }));
    case 'client':
      return rows(await permissionsApi.clients(configId, sid)).map((row) => ({
        id: row.clid,
        name: row.client_nickname,
        detail: row.client_type === '1' ? 'query' : undefined,
      }));
    case 'clientDb': {
      // Everyone the server knows, plus the clients online right now - a
      // just-connected one may not be in the database listing yet.
      const [known, online] = await Promise.all([
        permissionsApi.clientsDatabase(configId, sid).catch(() => []),
        permissionsApi.clients(configId, sid).catch(() => []),
      ]);
      const byId = new Map<string, EntityItem>();
      for (const row of rows(known)) byId.set(row.cldbid, { id: row.cldbid, name: row.client_nickname });
      for (const row of rows(online)) {
        if (row.client_database_id && !byId.has(row.client_database_id)) {
          byId.set(row.client_database_id, { id: row.client_database_id, name: row.client_nickname });
        }
      }
      return [...byId.values()];
    }
    case 'serverGroup':
      return rows(await permissionsApi.serverGroups(configId, sid)).map((row) => ({ id: row.sgid, name: row.name }));
    case 'channelGroup':
      return rows(await permissionsApi.channelGroups(configId, sid)).map((row) => ({ id: row.cgid, name: row.name }));
    case 'virtualServer':
      return rows(await serversApi.listVirtual(configId)).map((row) => ({
        id: row.virtualserver_id,
        name: row.virtualserver_name,
        detail: row.virtualserver_port ? `port ${row.virtualserver_port}` : undefined,
      }));
    case 'permission':
      return rows(await permissionsApi.list(configId, sid)).map((row) => ({ id: row.permname, name: row.permname, detail: row.permid }));
  }
}

/**
 * The list behind one kind of id. Fetched only while `enabled` - opening the
 * picker or explaining a value - and kept briefly, since the same list is
 * usually needed again a moment later.
 */
export function useEntityList(kind: EntityKind | null, configId: number | null, sid: number, enabled: boolean) {
  return useQuery({
    queryKey: ['console-entities', kind, configId, sid],
    queryFn: () => fetchEntities(kind!, configId!, sid),
    // Channels, clients and groups belong to a virtual server; the list of virtual
    // servers and the permission definitions do not.
    enabled: enabled && kind !== null && configId !== null && (sid > 0 || kind === 'virtualServer' || kind === 'permission'),
    staleTime: 30_000,
  });
}
