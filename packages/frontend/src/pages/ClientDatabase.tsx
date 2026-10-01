import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  buildBanIndex, findBanMatches,
  type BanIndex, type ClientDbProfile, type ClientDbSearchParams, type ClientDbSearchResult,
} from '@ts6/common';
import { Ban as BanIcon, Database, Eye, Loader2, MoreHorizontal, RefreshCw, Trash2, X } from 'lucide-react';
import { useServerStore } from '@/stores/server.store';
import {
  CLIENT_DB_BLOCK, flattenClientDbPages, useClientDbBanIndex, useClientDbList, useClientDbSearch,
  useOnlineDbIds, useRefreshClientDbList,
} from '@/hooks/use-client-database';
import { useChannels } from '@/hooks/use-channels';
import { useChannelGroups } from '@/hooks/use-groups';
import { DataTable, type DataTableFeatures } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { ClientDbSearchBar } from '@/components/client-database/ClientDbSearchBar';
import { ClientDbDetailDialog } from '@/components/client-database/ClientDbDetailDialog';
import { ClientDbBanDialog } from '@/components/client-database/ClientDbBanDialog';
import { ClientDbDeleteDialog } from '@/components/client-database/ClientDbDeleteDialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime } from '@/components/client-database/format';
import { tsErrorMessage } from '@/lib/ts-errors';
import { timeAgo } from '@/lib/utils';

/**
 * What the status and action cells need to know. It reaches them through context rather than through
 * the column definitions: new definitions would remount every cell, which closes a row menu that is
 * open at the moment the live client list changes.
 */
interface ViewState {
  banIndex: BanIndex;
  onlineIds: Set<number>;
  channels: any[];
  channelGroups: any[];
  /** custom-info search: what each listed profile matched on, by database id. */
  custom?: ClientDbSearchResult['custom'];
  /** channel-group search: the matching assignments of each listed profile, by database id. */
  assignments?: ClientDbSearchResult['channelGroups'];
}
const ViewStateContext = createContext<ViewState>({ banIndex: buildBanIndex([]), onlineIds: new Set(), channels: [], channelGroups: [] });

/** The "Matched on" column of a custom-info or channel-group search. */
function MatchCell({ profile }: { profile: ClientDbProfile }) {
  const { channels, channelGroups, custom, assignments } = useContext(ViewStateContext);
  if (custom) {
    return (
      <span className="font-mono-data text-xs break-all">
        {(custom[profile.cldbid] ?? []).map((e) => `${e.ident} = ${e.value}`).join(', ')}
      </span>
    );
  }
  const channelName = (cid: number) => channels.find((ch: any) => Number(ch.cid) === cid)?.channel_name ?? `#${cid}`;
  const groupName = (cgid: number) => channelGroups.find((g: any) => Number(g.cgid) === cgid)?.name ?? `#${cgid}`;
  return (
    <span className="text-xs">
      {(assignments?.[profile.cldbid] ?? []).map((a) => `${channelName(a.cid)}: ${groupName(a.cgid)}`).join(', ')}
    </span>
  );
}

function StatusCell({ profile }: { profile: ClientDbProfile }) {
  const { t } = useTranslation();
  const { banIndex, onlineIds } = useContext(ViewStateContext);
  const matches = findBanMatches(banIndex, profile);
  return (
    <div className="flex items-center gap-1.5 w-8">
      {matches.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild><span><BanIcon className="h-4 w-4 text-destructive" /></span></TooltipTrigger>
          <TooltipContent>{t('pages.clientDatabase.bannedBy', { count: matches.length })}</TooltipContent>
        </Tooltip>
      )}
      {onlineIds.has(profile.cldbid) && (
        <Tooltip>
          <TooltipTrigger asChild><span className="h-2 w-2 rounded-full bg-emerald-400" /></TooltipTrigger>
          <TooltipContent>{t('pages.clientDatabase.onlineNow')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface RowActionsProps {
  profile: ClientDbProfile;
  onDetails: (profile: ClientDbProfile) => void;
  onBan: (profile: ClientDbProfile) => void;
  onDelete: (profile: ClientDbProfile) => void;
}

function RowActions({ profile, onDetails, onBan, onDelete }: RowActionsProps) {
  const { t } = useTranslation();
  const { onlineIds } = useContext(ViewStateContext);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('common.actions')}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onDetails(profile)}>
          <Eye className="mr-2 h-4 w-4" /> {t('pages.clientDatabase.actions.details')}
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onBan(profile)}>
          <BanIcon className="mr-2 h-4 w-4" /> {t('pages.clientDatabase.actions.ban')}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={onlineIds.has(profile.cldbid)}
          onClick={() => onDelete(profile)}
        >
          <Trash2 className="mr-2 h-4 w-4" /> {t('pages.clientDatabase.actions.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function ClientDatabase() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { selectedConfigId, selectedSid } = useServerStore();

  const list = useClientDbList();
  const refreshList = useRefreshClientDbList();
  const [searchParams, setSearchParams] = useState<ClientDbSearchParams | null>(null);
  const search = useClientDbSearch(searchParams);
  const { index: banIndex } = useClientDbBanIndex();
  const onlineIds = useOnlineDbIds();
  const { data: channelData } = useChannels();
  const { data: channelGroupData } = useChannelGroups();
  const channels = useMemo(() => (Array.isArray(channelData) ? channelData : []), [channelData]);
  const channelGroups = useMemo(() => (Array.isArray(channelGroupData) ? channelGroupData : []), [channelGroupData]);

  const [selected, setSelected] = useState<ClientDbProfile[]>([]);
  const [selectionKey, setSelectionKey] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [banTargets, setBanTargets] = useState<ClientDbProfile[] | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<ClientDbProfile[] | null>(null);

  // "Load all" walks through the blocks one after the other; Stop (or leaving the page) ends it after the block in flight.
  const stopLoading = useRef(false);
  const [loadingAll, setLoadingAll] = useState(false);
  useEffect(() => () => { stopLoading.current = true; }, []);

  const loaded = useMemo(() => flattenClientDbPages(list.data), [list.data]);
  const total = list.data ? list.data.pages[list.data.pages.length - 1]?.total ?? 0 : 0;
  const searching = searchParams !== null;
  const rows: ClientDbProfile[] = searching ? (search.data?.entries ?? []) : loaded;

  const clearSelection = () => {
    setSelected([]);
    setSelectionKey((k) => k + 1);
  };

  const runSearch = (params: ClientDbSearchParams) => {
    clearSelection();
    setSearchParams(params);
  };
  const endSearch = () => {
    clearSelection();
    setSearchParams(null);
  };

  const refresh = () => {
    if (searching) search.refetch();
    else refreshList();
    qc.invalidateQueries({ queryKey: ['bans'] });
    qc.invalidateQueries({ queryKey: ['clients'] });
  };

  const loadAll = async () => {
    stopLoading.current = false;
    setLoadingAll(true);
    try {
      let more = list.hasNextPage;
      while (more && !stopLoading.current) {
        const result = await list.fetchNextPage();
        if (result.isError) break;
        more = result.hasNextPage;
      }
    } finally {
      setLoadingAll(false);
    }
  };

  // The column definitions depend on nothing that the live data changes (see ViewState).
  const showMatchColumn = !!(search.data?.custom || search.data?.channelGroups);
  const columns = useMemo<ColumnDef<DataTableFeatures, ClientDbProfile>[]>(() => {
    const cols: ColumnDef<DataTableFeatures, ClientDbProfile>[] = [
      {
        id: 'status',
        header: '',
        cell: ({ row }) => <StatusCell profile={row.original} />,
      },
      {
        accessorKey: 'nickname',
        header: t('pages.clientDatabase.columns.nickname'),
        cell: ({ row }) => <span className="font-medium">{row.original.nickname || '-'}</span>,
      },
      {
        accessorKey: 'cldbid',
        header: t('pages.clientDatabase.columns.dbId'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs">{getValue() as number}</span>,
      },
      {
        accessorKey: 'uid',
        header: t('pages.clientDatabase.columns.uid'),
        cell: ({ getValue }) => (
          <span className="font-mono-data text-xs truncate max-w-[180px] block" title={getValue() as string}>{(getValue() as string) || '-'}</span>
        ),
      },
      {
        accessorKey: 'lastConnected',
        header: t('pages.clientDatabase.columns.lastSeen'),
        cell: ({ getValue }) => {
          const seconds = getValue() as number;
          return <span className="text-xs text-muted-foreground" title={formatDateTime(seconds)}>{seconds ? timeAgo(seconds) : '-'}</span>;
        },
      },
      {
        accessorKey: 'totalConnections',
        header: t('pages.clientDatabase.columns.connections'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs">{getValue() as number}</span>,
      },
      {
        accessorKey: 'lastIp',
        header: t('pages.clientDatabase.columns.lastIp'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs">{(getValue() as string) || '-'}</span>,
      },
      {
        accessorKey: 'description',
        header: t('pages.clientDatabase.columns.description'),
        cell: ({ getValue }) => <span className="text-xs truncate max-w-[200px] block" title={getValue() as string}>{(getValue() as string) || '-'}</span>,
      },
    ];

    // What a custom-info or channel-group search matched each profile on.
    if (showMatchColumn) {
      cols.push({
        id: 'match',
        header: t('pages.clientDatabase.columns.match'),
        cell: ({ row }) => <MatchCell profile={row.original} />,
      });
    }

    cols.push({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <RowActions
          profile={row.original}
          onDetails={(p) => setDetailId(p.cldbid)}
          onBan={(p) => setBanTargets([p])}
          onDelete={(p) => setDeleteTargets([p])}
        />
      ),
    });
    return cols;
  }, [t, showMatchColumn]);

  const viewState = useMemo<ViewState>(
    () => ({
      banIndex, onlineIds, channels, channelGroups,
      custom: search.data?.custom,
      assignments: search.data?.channelGroups,
    }),
    [banIndex, onlineIds, channels, channelGroups, search.data],
  );

  if (!selectedConfigId || !selectedSid) return <EmptyState icon={Database} title={t('pages.noServerSelected')} />;
  if (list.isLoading) return <PageLoader />;
  if (list.isError) {
    return (
      <EmptyState icon={Database} title={t('pages.clientDatabase.loadFailed')} description={tsErrorMessage(list.error, '', t)}>
        <Button variant="outline" size="sm" onClick={() => list.refetch()}>{t('common.refresh')}</Button>
      </EmptyState>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">{t('nav.items.clientDatabase')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('pages.clientDatabase.subtitle')}</p>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={list.isFetching || search.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${list.isFetching || search.isFetching ? 'animate-spin' : ''}`} /> {t('common.refresh')}
          </Button>
        </div>

        <ClientDbSearchBar
          active={searching}
          busy={search.isFetching}
          channels={channels}
          channelGroups={channelGroups}
          onSearch={runSearch}
          onClear={endSearch}
        />

        {searching ? (
          <div className="card-hero flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
            {search.isFetching && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            {search.isError ? (
              <span className="text-destructive">{tsErrorMessage(search.error, t('pages.clientDatabase.search.failed'), t)}</span>
            ) : search.data ? (
              <>
                <span className="font-medium">{t('pages.clientDatabase.searchResults', { count: search.data.entries.length })}</span>
                {search.data.truncated && (
                  <span className="text-xs text-amber-400">
                    {searchParams?.mode === 'name' || searchParams?.mode === 'uid'
                      ? t('pages.clientDatabase.truncatedCap')
                      : t('pages.clientDatabase.truncatedList', { shown: search.data.entries.length, total: search.data.matchCount })}
                  </span>
                )}
              </>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">{t('pages.clientDatabase.loadedCount', { loaded: loaded.length, total })}</span>
            {list.hasNextPage && !loadingAll && (
              <>
                <Button size="sm" variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  {t('pages.clientDatabase.loadMore', { count: CLIENT_DB_BLOCK })}
                </Button>
                <Button size="sm" variant="outline" onClick={loadAll} disabled={list.isFetchingNextPage}>{t('pages.clientDatabase.loadAll')}</Button>
              </>
            )}
            {loadingAll && (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm">{t('pages.clientDatabase.loadingAll', { loaded: loaded.length, total })}</span>
                <Button size="sm" variant="ghost" onClick={() => { stopLoading.current = true; }}>{t('pages.clientDatabase.stop')}</Button>
              </>
            )}
          </div>
        )}

        {selected.length > 0 && (
          <div className="card-hero flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
            <span className="text-sm font-medium">{t('pages.clientDatabase.selectedCount', { count: selected.length })}</span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => setBanTargets(selected)}>
              <BanIcon className="h-3.5 w-3.5 mr-1.5" /> {t('pages.clientDatabase.actions.ban')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDeleteTargets(selected)}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> {t('pages.clientDatabase.actions.delete')}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="h-3.5 w-3.5 mr-1.5" /> {t('common.clear')}
            </Button>
          </div>
        )}

        <ViewStateContext.Provider value={viewState}>
          <DataTable
            columns={columns}
            data={rows}
            searchKey="nickname"
            searchPlaceholder={t('pages.clientDatabase.filterPlaceholder')}
            pageSize={50}
            horizontalScroll
            enableRowSelection
            getRowId={(p: ClientDbProfile) => String(p.cldbid)}
            onSelectionChange={setSelected}
            selectionResetKey={selectionKey}
            rowClassName={(p: ClientDbProfile) => (findBanMatches(banIndex, p).length > 0 ? 'bg-destructive/10 hover:bg-destructive/15' : undefined)}
            onRowClick={(p: ClientDbProfile) => setDetailId(p.cldbid)}
          />
        </ViewStateContext.Provider>

        <ClientDbDetailDialog
          cldbid={detailId}
          banIndex={banIndex}
          channels={channels}
          channelGroups={channelGroups}
          onClose={() => setDetailId(null)}
          onBan={(profile) => { setDetailId(null); setBanTargets([profile]); }}
          onDelete={(profile) => { setDetailId(null); setDeleteTargets([profile]); }}
        />
        {banTargets && <ClientDbBanDialog profiles={banTargets} onClose={() => setBanTargets(null)} onDone={clearSelection} />}
        {deleteTargets && (
          <ClientDbDeleteDialog profiles={deleteTargets} onlineIds={onlineIds} onClose={() => setDeleteTargets(null)} onDone={clearSelection} />
        )}
      </div>
    </TooltipProvider>
  );
}
