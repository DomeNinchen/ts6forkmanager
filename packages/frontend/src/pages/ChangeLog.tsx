import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import {
  UI_CHANGE_METHODS,
  UI_CHANGE_RANGES,
  UI_CHANGE_STATUSES,
  type UiChangeDiff,
  type UiChangeLogEntry,
  type UiChangeMethod,
  type UiChangeRange,
  type UiChangeStatus,
} from '@ts6/common';
import { changeLogApi } from '@/api/change-log.api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Pager } from '@/components/connection-journal/table-parts';
import { PAGE_SIZE_OPTIONS } from '@/components/connection-journal/format';
import { ChangeLogSettings } from '@/components/change-log/ChangeLogSettings';
import { useServers } from '@/hooks/use-servers';
import { roleLabel } from '@/lib/roles';

interface Filters {
  range: UiChangeRange;
  area: string;
  method: UiChangeMethod | 'all';
  status: UiChangeStatus | 'all';
  server: number | 'all';
  q: string;
}

const DEFAULT_FILTERS: Filters = { range: '7d', area: 'all', method: 'all', status: 'all', server: 'all', q: '' };

const STATUS_VARIANT: Record<UiChangeStatus, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  ok: 'success',
  error: 'destructive',
  denied: 'warning',
  pending: 'secondary',
};

/**
 * Who changed what through this interface, on which target, and how it ended (R6). Admin-only: the
 * rows name users and can carry the address a change came from. Secrets in a request are never
 * shown - only that the field was changed.
 */
export default function ChangeLog() {
  const { t } = useTranslation();
  const { data: servers } = useServers();
  const { data: areas } = useQuery({ queryKey: ['change-log', 'areas'], queryFn: changeLogApi.areas });
  const [tab, setTab] = useState<'log' | 'settings'>('log');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // The search box types freely; the list is asked once typing has paused.
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const patch = (change: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...change }));
    setPage(1);
  };
  // A new search also starts at the first page.
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setPage(1);
  }

  const query = {
    range: filters.range,
    area: filters.area === 'all' ? undefined : filters.area,
    method: filters.method === 'all' ? undefined : filters.method,
    status: filters.status === 'all' ? undefined : filters.status,
    server: filters.server === 'all' ? undefined : filters.server,
    q: filters.q || undefined,
    page,
    pageSize,
  };
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['change-log', 'list', query],
    queryFn: () => changeLogApi.list(query),
    placeholderData: keepPreviousData,
  });

  const filtered =
    filters.area !== 'all' || filters.method !== 'all' || filters.status !== 'all' || filters.server !== 'all'
    || filters.q !== '' || filters.range !== DEFAULT_FILTERS.range;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t('pages.changeLog.title')}</h1>
        <p className="text-xs text-muted-foreground mt-1">{t('pages.changeLog.subtitle')}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'log' | 'settings')}>
        <TabsList>
          <TabsTrigger value="log">{t('pages.changeLog.tabs.log')}</TabsTrigger>
          <TabsTrigger value="settings">{t('pages.changeLog.tabs.settings')}</TabsTrigger>
        </TabsList>

        <TabsContent value="log" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="change-log-filters">
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-9 w-full sm:w-56 pl-8"
                placeholder={t('pages.changeLog.searchPlaceholder')}
                aria-label={t('pages.changeLog.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Select value={filters.range} onValueChange={(v) => patch({ range: v as UiChangeRange })}>
              <SelectTrigger className="h-9 w-[150px]" aria-label={t('pages.changeLog.filters.range')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {UI_CHANGE_RANGES.map((r) => <SelectItem key={r} value={r}>{t(`pages.changeLog.range.${r}`)}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.area} onValueChange={(v) => patch({ area: v })}>
              <SelectTrigger className="h-9 w-[170px]" aria-label={t('pages.changeLog.filters.area')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('pages.changeLog.filters.anyArea')}</SelectItem>
                {(areas ?? []).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.method} onValueChange={(v) => patch({ method: v as Filters['method'] })}>
              <SelectTrigger className="h-9 w-[140px]" aria-label={t('pages.changeLog.filters.method')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('pages.changeLog.filters.anyMethod')}</SelectItem>
                {UI_CHANGE_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.status} onValueChange={(v) => patch({ status: v as Filters['status'] })}>
              <SelectTrigger className="h-9 w-[150px]" aria-label={t('pages.changeLog.filters.result')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('pages.changeLog.filters.anyResult')}</SelectItem>
                {UI_CHANGE_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`pages.changeLog.status.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>

            {servers && servers.length > 1 && (
              <Select value={String(filters.server)} onValueChange={(v) => patch({ server: v === 'all' ? 'all' : Number(v) })}>
                <SelectTrigger className="h-9 w-[170px]" aria-label={t('pages.changeLog.filters.server')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('pages.changeLog.filters.anyServer')}</SelectItem>
                  {servers.map((s: { id: number; name: string }) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => { setFilters(DEFAULT_FILTERS); setSearch(''); setPage(1); }}>
                {t('pages.changeLog.filters.reset')}
              </Button>
            )}
          </div>

          {isLoading ? (
            <PageLoader />
          ) : isError || !data ? (
            <p className="text-sm text-destructive">{t('pages.changeLog.loadFailed')}</p>
          ) : (
            <div className="space-y-3" aria-busy={isFetching}>
              <div className="card-hero rounded-md border border-border overflow-x-auto lounge:rounded-none lounge:border-0 lounge:border-t-2 lounge:border-foreground/80 lounge:bg-transparent lounge:shadow-none">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 lounge:bg-transparent text-left text-muted-foreground">
                      <th className="h-10 px-3 font-medium">{t('pages.changeLog.columns.time')}</th>
                      <th className="h-10 px-3 font-medium">{t('pages.changeLog.columns.user')}</th>
                      <th className="h-10 px-3 font-medium">{t('pages.changeLog.columns.action')}</th>
                      <th className="h-10 px-3 font-medium">{t('pages.changeLog.columns.target')}</th>
                      <th className="h-10 px-3 font-medium">{t('pages.changeLog.columns.result')}</th>
                      <th className="h-10 px-3 font-medium">{t('pages.changeLog.columns.address')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="h-24 text-center text-muted-foreground">{t('pages.changeLog.empty')}</td>
                      </tr>
                    ) : (
                      data.entries.map((entry) => <ChangeRow key={entry.id} entry={entry} />)
                    )}
                  </tbody>
                </table>
              </div>

              <Pager
                page={page}
                pageSize={pageSize}
                total={data.total}
                onPage={setPage}
                countText={t('pages.changeLog.resultCount', { count: data.total })}
                extra={
                  <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                    <SelectTrigger className="h-8 w-[110px] text-xs" aria-label={t('pages.changeLog.filters.pageSize')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>{t('pages.changeLog.perPage', { count: n })}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <ChangeLogSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** The request body as the server stored it (secrets already reduced to a placeholder), indented when it is whole JSON. */
function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // A body cut at the length cap is no longer valid JSON; it is shown as stored.
    return body;
  }
}

/** Before and after of a change (R6 stage 2): the changed fields, or what was deleted, or why the state before is missing. */
function DiffView({ diff }: { diff: UiChangeDiff }) {
  const { t } = useTranslation();
  const value = (v: string | null) =>
    v === null ? <span className="italic text-muted-foreground">{t('pages.changeLog.diff.notSet')}</span> : <span className="break-all">{v}</span>;
  const pairs = (row: Record<string, string>) => Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' · ');

  return (
    <div className="mt-1 space-y-1 rounded bg-muted/40 p-2">
      {diff.unavailable && <p className="text-muted-foreground">{t('pages.changeLog.diff.unavailable', { reason: diff.unavailable })}</p>}
      {diff.fields && (diff.fields.length === 0 ? (
        <p className="text-muted-foreground">{t('pages.changeLog.diff.noField')}</p>
      ) : (
        // Stacked rather than a table: the column is narrow, and a permission name is long.
        <ul className="space-y-1 font-mono-data">
          {diff.fields.map((f) => (
            <li key={f.field}>
              <div className="break-words text-muted-foreground">{f.field}</div>
              <div className="pl-2">
                <span className="sr-only">{t('pages.changeLog.diff.before')}: </span>{value(f.before)}
                <span aria-hidden="true" className="px-1 text-muted-foreground">→</span>
                <span className="sr-only">{t('pages.changeLog.diff.after')}: </span>{value(f.after)}
              </div>
            </li>
          ))}
        </ul>
      ))}
      {diff.deleted && (
        <div>
          <p className="text-muted-foreground">{t('pages.changeLog.diff.deleted')}</p>
          <dl className="font-mono-data">
            {Object.entries(diff.deleted).map(([k, v]) => (
              <div key={k} className="flex gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v}</dd></div>
            ))}
          </dl>
        </div>
      )}
      {diff.deletedList && (
        <div>
          <p className="text-muted-foreground">{t('pages.changeLog.diff.deletedList', { count: diff.deletedList.count, shown: diff.deletedList.items.length })}</p>
          <ul className="max-h-48 overflow-auto font-mono-data">
            {diff.deletedList.items.map((row, i) => <li key={i} className="break-all">{pairs(row)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChangeRow({ entry }: { entry: UiChangeLogEntry }) {
  const { t } = useTranslation();
  const server = entry.serverConfigId !== null ? entry.serverName ?? `#${entry.serverConfigId}` : null;
  const target = [
    server,
    entry.virtualServerId !== null ? t('pages.changeLog.virtualServer', { id: entry.virtualServerId }) : null,
    entry.targetId !== null ? `ID ${entry.targetId}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors align-top" data-testid="change-log-row" data-status={entry.status}>
      <td className="px-3 py-2.5 whitespace-nowrap font-mono-data text-xs">{new Date(entry.createdAt).toLocaleString()}</td>
      <td className="px-3 py-2.5">
        <div className="font-mono-data whitespace-nowrap">{entry.username}</div>
        <div className="text-[11px] text-muted-foreground">{roleLabel(t, entry.role)}</div>
      </td>
      <td className="px-3 py-2.5 min-w-[220px]">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono-data">{entry.method}</Badge>
          <span>{entry.area}</span>
        </div>
        <div className="font-mono-data text-[11px] text-muted-foreground break-all mt-1">{entry.routePattern}</div>
        {entry.changes && (
          <details className="mt-1 text-[11px]" data-testid="change-log-diff">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('pages.changeLog.diff.title')}</summary>
            <DiffView diff={entry.changes} />
          </details>
        )}
        {entry.body && (
          <details className="mt-1 text-[11px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t('pages.changeLog.body')}</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 font-mono-data whitespace-pre-wrap break-all" data-testid="change-log-body">
              {prettyBody(entry.body)}
            </pre>
          </details>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs">{target || <span className="text-muted-foreground">–</span>}</td>
      <td className="px-3 py-2.5 text-xs">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Badge variant={STATUS_VARIANT[entry.status]}>{t(`pages.changeLog.status.${entry.status}`)}</Badge>
          {entry.httpStatus !== null && <span className="font-mono-data text-muted-foreground">{entry.httpStatus}</span>}
          {entry.durationMs !== null && <span className="font-mono-data text-muted-foreground">{entry.durationMs} ms</span>}
        </div>
        {entry.errorMessage && <div className="mt-1 text-destructive break-words">{entry.errorMessage}</div>}
        {entry.loggedToTeamSpeak && <div className="mt-1 text-muted-foreground">{t('pages.changeLog.tsLogged')}</div>}
      </td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
        {entry.ip ? <span className="font-mono-data">{entry.ip}</span> : <span className="text-muted-foreground">{t('pages.changeLog.ipNotRecorded')}</span>}
      </td>
    </tr>
  );
}
