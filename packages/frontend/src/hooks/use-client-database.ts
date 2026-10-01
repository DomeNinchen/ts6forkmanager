import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  buildBanIndex,
  toBan,
  type ClientDbBanRequest,
  type ClientDbListPage,
  type ClientDbProfile,
  type ClientDbSearchParams,
} from '@ts6/common';
import { clientDatabaseApi } from '../api/client-database.api';
import { useServerStore } from '../stores/server.store';
import { useBans } from './use-bans';
import { useClients } from './use-clients';

/** Profiles per request; also the size of the "load more" step. */
export const CLIENT_DB_BLOCK = 200;

const LIST_KEY = 'client-database-list';

/**
 * The client database, newest profiles first, one block per page. Every page counts the profiles
 * already loaded as its offset, so "load more" reaches back towards the oldest profile.
 */
export function useClientDbList() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useInfiniteQuery({
    queryKey: [LIST_KEY, c, s],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => clientDatabaseApi.list(c!, s!, pageParam, CLIENT_DB_BLOCK),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, page) => n + page.entries.length, 0);
      return lastPage.entries.length > 0 && loaded < lastPage.total ? loaded : undefined;
    },
    enabled: !!c && !!s,
    // Re-reading every block that is loaded on each visit could be dozens of requests; the page's
    // Refresh button starts over from the newest block instead.
    staleTime: Infinity,
  });
}

/** All loaded blocks as one list without duplicates (a profile that joined meanwhile can shift a block boundary), newest first. */
export function flattenClientDbPages(data: InfiniteData<ClientDbListPage> | undefined): ClientDbProfile[] {
  if (!data) return [];
  const byId = new Map<number, ClientDbProfile>();
  for (const page of data.pages) for (const profile of page.entries) byId.set(profile.cldbid, profile);
  return [...byId.values()].sort((a, b) => b.cldbid - a.cldbid);
}

export function useClientDbSearch(params: ClientDbSearchParams | null) {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['client-database-search', c, s, params],
    queryFn: () => clientDatabaseApi.search(c!, s!, params!),
    enabled: !!c && !!s && !!params,
    staleTime: 0,
    retry: false,
  });
}

export function useClientDbDetails(cldbid: number | null) {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useQuery({
    queryKey: ['client-database-details', c, s, cldbid],
    queryFn: () => clientDatabaseApi.details(c!, s!, cldbid!),
    enabled: !!c && !!s && cldbid !== null,
    staleTime: 0,
    retry: false,
  });
}

/** The server's ban rules, prepared for matching profiles against them (shares the Bans page's query). */
export function useClientDbBanIndex() {
  const { data, isLoading } = useBans();
  const rules = useMemo(() => (Array.isArray(data) ? data.map(toBan) : []), [data]);
  const index = useMemo(() => buildBanIndex(rules), [rules]);
  return { rules, index, isLoading };
}

/** Database ids of the clients connected right now (the live list refreshes every few seconds). */
export function useOnlineDbIds(): Set<number> {
  const { data } = useClients();
  return useMemo(
    () => new Set(
      (Array.isArray(data) ? data : [])
        .filter((client: any) => String(client.client_type) === '0')
        .map((client: any) => Number(client.client_database_id)),
    ),
    [data],
  );
}

export function useBanProfiles() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: (request: ClientDbBanRequest) => clientDatabaseApi.ban(c!, s!, request),
    onSuccess: () => {
      // The ban list is what the highlighting is computed from, and a banned client that was online is gone.
      qc.invalidateQueries({ queryKey: ['bans'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['client-database-details'] });
    },
  });
}

export function useDeleteProfiles() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return useMutation({
    mutationFn: (cldbids: number[]) => clientDatabaseApi.remove(c!, s!, cldbids),
    onSuccess: (result) => {
      const gone = new Set(result.deleted);
      if (gone.size > 0) {
        // Drop the deleted profiles from the blocks already loaded instead of re-reading all of them.
        qc.setQueryData<InfiniteData<ClientDbListPage>>([LIST_KEY, c, s], (old) =>
          old && {
            ...old,
            pages: old.pages.map((page) => ({
              total: Math.max(0, page.total - gone.size),
              entries: page.entries.filter((profile) => !gone.has(profile.cldbid)),
            })),
          });
        qc.invalidateQueries({ queryKey: ['client-database-search'] });
        qc.invalidateQueries({ queryKey: ['client-database-details'] });
      }
    },
  });
}

/**
 * Drops every block but the newest and reads that one again. The page keeps showing what it has
 * meanwhile (a full reset would swap the whole page for the loading screen and lose the search bar's input).
 */
export function useRefreshClientDbList() {
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  return () => {
    qc.setQueryData<InfiniteData<ClientDbListPage>>([LIST_KEY, c, s], (old) =>
      old && { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) });
    return qc.refetchQueries({ queryKey: [LIST_KEY, c, s] });
  };
}
