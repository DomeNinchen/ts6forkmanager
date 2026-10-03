import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  buildBanIndex, findBanMatches,
  type BanIndex, type ClientDbAssignableGroup, type ClientDbProfile, type ClientDbSearchParams, type ClientDbSearchResult,
} from '@ts6/common';
import { Ban as BanIcon, Database, Download, Eye, Loader2, MoreHorizontal, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useServerStore } from '@/stores/server.store';
import { useClientDatabaseViewStore, type ClientDbColumnId } from '@/stores/client-database.store';
import {
  CLIENT_DB_BLOCK, flattenClientDbPages, useChangeGroupMembership, useClientDbBanIndex, useClientDbGroups,
  useClientDbList, useClientDbSearch, useOnlineDbIds, useRefreshClientDbList,
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
import { ClientDbColumnsMenu } from '@/components/client-database/ClientDbColumnsMenu';
import { ClientDbExportDialog } from '@/components/client-database/ClientDbExportDialog';
import { COLUMN_LABEL_KEYS } from '@/components/client-database/columns';
import { formatDateTime } from '@/components/client-database/format';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ExportColumn } from '@/lib/client-database-export';
import { tsErrorMessage } from '@/lib/ts-errors';
import { timeAgo } from '@/lib/utils';

// Stable empty values: a fresh [] on every render would look like new data to the table and to the memos.
const NO_PROFILES: ClientDbProfile[] = [];
const NO_GROUPS: ClientDbAssignableGroup[] = [];

/**
 * What the cells need to know. It reaches them through context rather than through the column
 * definitions: new definitions would remount every cell, which closes a row menu that is open at the
 * moment the live client list changes.
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
  /** Group mode: who is in each server group. */
  memberSets: Map<number, Set<number>>;
  /** Group mode: groups whose members TeamSpeak refused to list. */
  failedGroups: Set<number>;
  changeMembership: (profile: ClientDbProfile, group: ClientDbAssignableGroup, member: boolean) => void;
}
const ViewStateContext = createContext<ViewState>({
  banIndex: buildBanIndex([]),
  onlineIds: new Set(),
  channels: [],
  channelGroups: [],
  memberSets: new Map(),
  failedGroups: new Set(),
  changeMembership: () => {},
});

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

/** One checkbox of group mode: is this profile in this server group, and a click changes that. */
function GroupCell({ profile, group }: { profile: ClientDbProfile; group: ClientDbAssignableGroup }) {
  const { t } = useTranslation();
  const { memberSets, failedGroups, changeMembership } = useContext(ViewStateContext);
  const failed = failedGroups.has(group.sgid);
  return (
    <Checkbox
      checked={memberSets.get(group.sgid)?.has(profile.cldbid) ?? false}
      disabled={failed}
      title={failed ? t('pages.clientDatabase.groups.unavailable') : undefined}
      aria-label={group.name}
      onCheckedChange={(checked) => changeMembership(profile, group, !!checked)}
    />
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
  const [showExport, setShowExport] = useState(false);
  /** Every row the table shows, across its pages, after filter and sort (what "current view" exports). */
  const [visibleRows, setVisibleRows] = useState<ClientDbProfile[]>(NO_PROFILES);

  // "Load all" walks through the blocks one after the other; Stop (or leaving the page) ends it after the block in flight.
  const stopLoading = useRef(false);
  const [loadingAll, setLoadingAll] = useState(false);
  useEffect(() => () => { stopLoading.current = true; }, []);

  const loaded = useMemo(() => flattenClientDbPages(list.data), [list.data]);
  const total = list.data ? list.data.pages[list.data.pages.length - 1]?.total ?? 0 : 0;
  const searching = searchParams !== null;
  const rows = useMemo(
    () => (searching ? (search.data?.entries ?? NO_PROFILES) : loaded),
    [searching, search.data, loaded],
  );

  // ---- column views and group mode ----
  const serverKey = `${selectedConfigId}:${selectedSid}`;
  const visibleColumns = useClientDatabaseViewStore((s) => s.visibleColumns);
  const hiddenGroupIds = useClientDatabaseViewStore((s) => s.hiddenGroups[serverKey]);
  const [groupMode, setGroupMode] = useState(false);
  const groupsQuery = useClientDbGroups(groupMode);
  const assignableGroups = groupsQuery.data?.groups ?? NO_GROUPS;
  const groupColumns = useMemo(
    () => (groupMode ? assignableGroups.filter((g) => !(hiddenGroupIds ?? []).includes(g.sgid)) : NO_GROUPS),
    [groupMode, assignableGroups, hiddenGroupIds],
  );
  const memberSets = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const [sgid, ids] of Object.entries(groupsQuery.data?.members ?? {})) map.set(Number(sgid), new Set(ids));
    return map;
  }, [groupsQuery.data?.members]);
  const failedGroups = useMemo(() => new Set(groupsQuery.data?.failed ?? []), [groupsQuery.data?.failed]);

  const changeGroup = useChangeGroupMembership();
  // The click handler is kept in a ref so the context value (and with it every cell) does not change on each render.
  const changeMembershipImpl = async (profile: ClientDbProfile, group: ClientDbAssignableGroup, member: boolean, isUndo = false) => {
    const name = profile.nickname || `#${profile.cldbid}`;
    try {
      await changeGroup.mutateAsync({ sgid: group.sgid, cldbid: profile.cldbid, member });
      toast.success(
        t(member ? 'pages.clientDatabase.groups.added' : 'pages.clientDatabase.groups.removed', { name, group: group.name }),
        isUndo ? undefined : {
          duration: 7000,
          action: { label: t('pages.clientDatabase.groups.undo'), onClick: () => { void changeMembershipRef.current(profile, group, !member, true); } },
        },
      );
    } catch (err) {
      // Which change failed first, then why - TeamSpeak's own words alone ("invalid clientID") say too little.
      const what = t('pages.clientDatabase.groups.changeFailed', { name, group: group.name });
      const why = tsErrorMessage(err, '', t);
      toast.error(why ? `${what}: ${why}` : what);
    }
  };
  const changeMembershipRef = useRef(changeMembershipImpl);
  changeMembershipRef.current = changeMembershipImpl;
  const changeMembership = useCallback(
    (profile: ClientDbProfile, group: ClientDbAssignableGroup, member: boolean) => { void changeMembershipRef.current(profile, group, member); },
    [],
  );

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
    if (groupMode) groupsQuery.refetch();
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

  /** For the export's "whole database" scope: reads the blocks that are missing and hands back every profile. */
  const loadWholeDatabase = async (onProgress: (loaded: number) => void, shouldStop: () => boolean) => {
    let data = list.data;
    let more = list.hasNextPage;
    while (more && !shouldStop()) {
      const result = await list.fetchNextPage();
      if (result.isError) throw result.error;
      data = result.data;
      onProgress(flattenClientDbPages(data).length);
      more = result.hasNextPage;
    }
    return flattenClientDbPages(data);
  };

  // The column definitions depend on nothing that the live data changes (see ViewState).
  const showMatchColumn = !!(search.data?.custom || search.data?.channelGroups);
  const groupColumnsKey = groupColumns.map((g) => `${g.sgid}:${g.name}`).join('|');
  const columns = useMemo<ColumnDef<DataTableFeatures, ClientDbProfile>[]>(() => {
    const label = (id: ClientDbColumnId) => t(`pages.clientDatabase.columns.${COLUMN_LABEL_KEYS[id]}`);
    const ago = (seconds: number) => (
      <span className="text-xs text-muted-foreground" title={formatDateTime(seconds)}>{seconds ? timeAgo(seconds) : '-'}</span>
    );
    const defs: Record<ClientDbColumnId, ColumnDef<DataTableFeatures, ClientDbProfile>> = {
      status: { id: 'status', header: '', cell: ({ row }) => <StatusCell profile={row.original} /> },
      nickname: {
        accessorKey: 'nickname',
        header: label('nickname'),
        cell: ({ row }) => <span className="font-medium">{row.original.nickname || '-'}</span>,
      },
      cldbid: {
        accessorKey: 'cldbid',
        header: label('cldbid'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs">{getValue() as number}</span>,
      },
      uid: {
        accessorKey: 'uid',
        header: label('uid'),
        cell: ({ getValue }) => (
          <span className="font-mono-data text-xs truncate max-w-[180px] block" title={getValue() as string}>{(getValue() as string) || '-'}</span>
        ),
      },
      created: { accessorKey: 'created', header: label('created'), cell: ({ getValue }) => ago(getValue() as number) },
      lastConnected: { accessorKey: 'lastConnected', header: label('lastConnected'), cell: ({ getValue }) => ago(getValue() as number) },
      totalConnections: {
        accessorKey: 'totalConnections',
        header: label('totalConnections'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs">{getValue() as number}</span>,
      },
      lastIp: {
        accessorKey: 'lastIp',
        header: label('lastIp'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs">{(getValue() as string) || '-'}</span>,
      },
      description: {
        accessorKey: 'description',
        header: label('description'),
        cell: ({ getValue }) => <span className="text-xs truncate max-w-[200px] block" title={getValue() as string}>{(getValue() as string) || '-'}</span>,
      },
      loginName: {
        accessorKey: 'loginName',
        header: label('loginName'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs">{(getValue() as string) || '-'}</span>,
      },
    };
    const cols = visibleColumns.filter((id) => id in defs).map((id) => defs[id]);

    // Group mode: one checkbox column per server group that is switched on in the columns menu.
    for (const group of groupColumns) {
      cols.push({
        id: `group-${group.sgid}`,
        header: () => <span className="block max-w-[96px] truncate text-xs font-medium" title={group.name}>{group.name}</span>,
        cell: ({ row }) => <GroupCell profile={row.original} group={group} />,
      });
    }

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
    // groupColumns is keyed by groupColumnsKey: the array itself is rebuilt whenever a membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, visibleColumns, groupColumnsKey, showMatchColumn]);

  const viewState = useMemo<ViewState>(
    () => ({
      banIndex, onlineIds, channels, channelGroups,
      custom: search.data?.custom,
      assignments: search.data?.channelGroups,
      memberSets, failedGroups, changeMembership,
    }),
    [banIndex, onlineIds, channels, channelGroups, search.data, memberSets, failedGroups, changeMembership],
  );

  /** What the export writes: the same columns as the list shows, plus the chosen group columns. */
  const exportColumns = useMemo<ExportColumn<ClientDbProfile>[]>(() => {
    const label = (id: ClientDbColumnId) => t(`pages.clientDatabase.columns.${COLUMN_LABEL_KEYS[id]}`);
    const cols: ExportColumn<ClientDbProfile>[] = [];
    for (const id of visibleColumns) {
      switch (id) {
        case 'status':
          cols.push(
            { key: 'online', header: t('pages.clientDatabase.export.online'), kind: 'flag', value: (p) => onlineIds.has(p.cldbid) },
            { key: 'banned', header: t('pages.clientDatabase.export.banned'), kind: 'flag', value: (p) => findBanMatches(banIndex, p).length > 0 },
          );
          break;
        case 'nickname': cols.push({ key: 'nickname', header: label(id), kind: 'userText', value: (p) => p.nickname }); break;
        case 'cldbid': cols.push({ key: 'cldbid', header: label(id), kind: 'number', value: (p) => p.cldbid }); break;
        case 'uid': cols.push({ key: 'uid', header: label(id), kind: 'text', value: (p) => p.uid }); break;
        case 'created': cols.push({ key: 'created', header: label(id), kind: 'date', value: (p) => p.created }); break;
        case 'lastConnected': cols.push({ key: 'lastConnected', header: label(id), kind: 'date', value: (p) => p.lastConnected }); break;
        case 'totalConnections': cols.push({ key: 'totalConnections', header: label(id), kind: 'number', value: (p) => p.totalConnections }); break;
        case 'lastIp': cols.push({ key: 'lastIp', header: label(id), kind: 'text', value: (p) => p.lastIp }); break;
        case 'description': cols.push({ key: 'description', header: label(id), kind: 'userText', value: (p) => p.description }); break;
        case 'loginName': cols.push({ key: 'loginName', header: label(id), kind: 'userText', value: (p) => p.loginName }); break;
      }
    }
    for (const group of groupColumns) {
      cols.push({ key: `group_${group.sgid}`, header: group.name, kind: 'flag', value: (p) => memberSets.get(group.sgid)?.has(p.cldbid) ?? false });
    }
    return cols;
  }, [t, visibleColumns, groupColumns, memberSets, onlineIds, banIndex]);

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
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={groupMode} onCheckedChange={setGroupMode} aria-label={t('pages.clientDatabase.groupMode.label')} />
              {t('pages.clientDatabase.groupMode.label')}
              {groupMode && groupsQuery.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
            </label>
            {groupMode && groupsQuery.isError && (
              <span className="text-xs text-destructive">{t('pages.clientDatabase.groupMode.loadFailed')}</span>
            )}
            <ClientDbColumnsMenu serverKey={serverKey} groups={assignableGroups} groupMode={groupMode} />
            <Button size="sm" variant="outline" onClick={() => setShowExport(true)}>
              <Download className="h-4 w-4 mr-1" /> {t('pages.clientDatabase.export.button')}
            </Button>
            <Button size="sm" variant="outline" onClick={refresh} disabled={list.isFetching || search.isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${list.isFetching || search.isFetching ? 'animate-spin' : ''}`} /> {t('common.refresh')}
            </Button>
          </div>
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
            onVisibleRowsChange={setVisibleRows}
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
        {showExport && (
          <ClientDbExportDialog
            sid={selectedSid}
            columns={exportColumns}
            selected={selected}
            visible={visibleRows}
            loaded={loaded}
            total={total}
            loadWholeDatabase={loadWholeDatabase}
            onClose={() => setShowExport(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
