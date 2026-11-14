import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Users, Hash, Shield, ShieldCheck, Bot, Music, type LucideIcon } from 'lucide-react';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { useSelectedServer } from '@/hooks/use-servers';
import { clientsApi } from '@/api/clients.api';
import { channelsApi } from '@/api/channels.api';
import { groupsApi } from '@/api/groups.api';
import { botsApi } from '@/api/bots.api';
import { musicBotsApi } from '@/api/music.api';
import type { UserPermission } from '@ts6/common';

export interface SearchEntry {
  id: string;
  /** Visible name first; see searchEntries. */
  terms: string[];
  label: string;
  hint: string;
  icon: LucideIcon;
  to: string;
}

export interface ObjectGroup {
  key: string;
  label: string;
  items: SearchEntry[];
}

const list = (data: unknown): any[] => (Array.isArray(data) ? data : []);

/**
 * The selected server's objects for the global search. A type is loaded only while the search is
 * open, only when the user may open its page (`visiblePages`, the sidebar's own filter) and read
 * its list route, and with the same query keys as the pages - a fresh page cache is reused, and the
 * search never polls on its own (no refetchInterval).
 */
export function useSearchObjects(open: boolean, visiblePages: Set<string>): { groups: ObjectGroup[]; noWebQuery: boolean } {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const { server, hasWebQuery } = useSelectedServer();
  const can = useAuthStore((st) => st.can);
  useAuthStore((st) => st.user?.permissions);
  const may = (page: string, permission?: UserPermission) =>
    open && visiblePages.has(page) && (!permission || can(permission));
  const vs = !!c && !!s;
  // Fetched when the window opens (unless the cache is under 30 s old), never again while it stays open.
  const once = { refetchInterval: false, staleTime: 30_000 } as const;

  const clients = useQuery({ queryKey: ['clients', c, s], queryFn: () => clientsApi.list(c!, s!), enabled: vs && may('/clients', 'server.view'), ...once });
  const channels = useQuery({ queryKey: ['channels', c, s], queryFn: () => channelsApi.list(c!, s!), enabled: vs && may('/channels', 'server.view'), ...once });
  const serverGroups = useQuery({ queryKey: ['server-groups', c, s], queryFn: () => groupsApi.serverGroups(c!, s!), enabled: vs && may('/server-groups', 'groups.view'), ...once });
  const channelGroups = useQuery({ queryKey: ['channel-groups', c, s], queryFn: () => groupsApi.channelGroups(c!, s!), enabled: vs && may('/channel-groups', 'groups.members'), ...once });
  const flows = useQuery({ queryKey: ['bots'], queryFn: botsApi.list, enabled: may('/bots', 'server.view'), ...once });
  const musicBots = useQuery({ queryKey: ['music-bots'], queryFn: musicBotsApi.list, enabled: !!c && may('/music-bots'), ...once });

  // Object ids carry the connection and virtual server, so a recent entry never resolves to another server's object.
  const at = `${c}:${s}`;
  const show = (page: string, data: unknown) => (visiblePages.has(page) ? list(data) : []);
  // Memoised on the data: the search re-runs on every key and hover, the mapping need not.
  const groups = useMemo<ObjectGroup[]>(() => [
    {
      key: 'clients',
      label: t('nav.search.types.clients'),
      // Voice clients only, like the Clients page; the database id stays the same across reconnects.
      items: show('/clients', clients.data).filter((cl) => String(cl.client_type) === '0').map((cl) => ({
        id: `client:${at}:${cl.client_database_id}`,
        terms: [String(cl.client_nickname ?? '')],
        label: String(cl.client_nickname ?? ''),
        hint: t('nav.search.types.client'),
        icon: Users,
        to: `/clients?q=${encodeURIComponent(String(cl.client_nickname ?? ''))}`,
      })),
    },
    {
      key: 'channels',
      label: t('nav.search.types.channels'),
      items: show('/channels', channels.data).map((ch) => ({
        id: `channel:${at}:${ch.cid}`,
        terms: [String(ch.channel_name ?? '')],
        label: String(ch.channel_name ?? ''),
        hint: t('nav.search.types.channel'),
        icon: Hash,
        to: `/channels?cid=${ch.cid}`,
      })),
    },
    {
      key: 'server-groups',
      label: t('nav.items.serverGroups'),
      items: show('/server-groups', serverGroups.data).map((g) => ({
        id: `sgroup:${at}:${g.sgid}`,
        terms: [String(g.name ?? '')],
        label: String(g.name ?? ''),
        hint: t('nav.search.types.serverGroup'),
        icon: Shield,
        to: `/server-groups?sgid=${g.sgid}`,
      })),
    },
    {
      key: 'channel-groups',
      label: t('nav.items.channelGroups'),
      items: show('/channel-groups', channelGroups.data).map((g) => ({
        id: `cgroup:${at}:${g.cgid}`,
        terms: [String(g.name ?? '')],
        label: String(g.name ?? ''),
        hint: t('nav.search.types.channelGroup'),
        icon: ShieldCheck,
        to: `/channel-groups?cgid=${g.cgid}`,
      })),
    },
    {
      key: 'flows',
      label: t('nav.items.botFlows'),
      // The list holds every server the user may see; the search stays on the selected virtual server.
      // The store may hold the sid as text ("1"), the flow list as a number.
      items: show('/bots', flows.data).filter((f) => Number(f.serverConfigId) === Number(c) && Number(f.virtualServerId) === Number(s)).map((f) => ({
        id: `flow:${f.id}`,
        terms: [String(f.name ?? '')],
        label: String(f.name ?? ''),
        hint: t('nav.search.types.flow'),
        icon: Bot,
        to: `/bots/${f.id}`,
      })),
    },
    {
      key: 'music-bots',
      label: t('nav.items.musicBots'),
      items: show('/music-bots', musicBots.data).filter((b) => Number(b.serverConfigId) === Number(c)).map((b) => ({
        id: `musicbot:${b.id}`,
        terms: [String(b.name ?? ''), String(b.nickname ?? '')],
        label: String(b.name ?? ''),
        hint: t('nav.search.types.musicBot'),
        icon: Music,
        to: `/music-bots?bot=${b.id}`,
      })),
    },
  ], [clients.data, channels.data, serverGroups.data, channelGroups.data, flows.data, musicBots.data, at, c, s, visiblePages, t]);
  return { groups, noWebQuery: !!server && !hasWebQuery };
}
