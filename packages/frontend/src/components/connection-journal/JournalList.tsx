import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Filter } from 'lucide-react';
import type { ConnectionJournalEntryDto, JournalSortColumn } from '@ts6/common';
import { connectionJournalApi } from '@/api/connection-journal.api';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { describeUserAgent, PAGE_SIZE_OPTIONS } from './format';
import { toQuery, type JournalFilterState } from './filters';
import { Pager, SortHeader, type SortOrder } from './table-parts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function JournalList({
  filters, onFilterIp,
}: {
  filters: JournalFilterState;
  /** Clicking an address narrows the list to it. */
  onFilterIp: (ip: string) => void;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<JournalSortColumn>('at');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const query = toQuery(filters, page, pageSize);
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['connection-journal', 'list', query, sort, order],
    queryFn: () => connectionJournalApi.list({ ...query, sort, order }),
    placeholderData: keepPreviousData,
  });

  // A new filter starts again at the first page: the one being looked at may not exist any more.
  const [seenFilters, setSeenFilters] = useState(filters);
  if (seenFilters !== filters) {
    setSeenFilters(filters);
    setPage(1);
  }

  const onSort = (column: JournalSortColumn) => {
    if (column === sort) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(column);
      // Time and counts read best newest/most first; names and addresses from A.
      setOrder(column === 'at' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  if (isLoading) return <PageLoader />;
  if (isError || !data) return <p className="text-sm text-destructive">{t('pages.connectionJournal.loadFailed')}</p>;

  const header = (column: JournalSortColumn, labelKey: string) => (
    <SortHeader column={column} label={t(labelKey)} sort={sort} order={order} onSort={onSort} />
  );

  return (
    <div className="space-y-3" aria-busy={isFetching}>
      <div className="card-hero rounded-md border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {header('at', 'pages.connectionJournal.columns.time')}
              {header('event', 'pages.connectionJournal.columns.event')}
              {header('result', 'pages.connectionJournal.columns.result')}
              {header('username', 'pages.connectionJournal.columns.account')}
              {header('ip', 'pages.connectionJournal.columns.address')}
              {header('reason', 'pages.connectionJournal.columns.details')}
            </tr>
          </thead>
          <tbody>
            {data.entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="h-24 text-center text-muted-foreground">{t('pages.connectionJournal.empty')}</td>
              </tr>
            ) : (
              data.entries.map((entry) => <JournalRow key={entry.id} entry={entry} onFilterIp={onFilterIp} />)
            )}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageSize={pageSize}
        total={data.total}
        onPage={setPage}
        extra={
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{t('pages.connectionJournal.perPage', { count: n })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}

function JournalRow({ entry, onFilterIp }: { entry: ConnectionJournalEntryDto; onFilterIp: (ip: string) => void }) {
  const { t } = useTranslation();
  const device = describeUserAgent(entry.userAgent);
  const unknownAccount = entry.reason === 'unknown-user';

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors" data-testid="journal-row">
      <td className="px-3 py-2.5 align-middle whitespace-nowrap font-mono-data text-xs">
        {new Date(entry.at).toLocaleString()}
      </td>
      <td className="px-3 py-2.5 align-middle whitespace-nowrap">{t(`pages.connectionJournal.event.${entry.event}`)}</td>
      <td className="px-3 py-2.5 align-middle">
        <Badge variant={entry.result === 'success' ? 'success' : 'destructive'}>
          {t(`pages.connectionJournal.result.${entry.result}`)}
        </Badge>
      </td>
      <td className="px-3 py-2.5 align-middle">
        {entry.username ? (
          <span className="font-mono-data break-all" title={unknownAccount ? t('pages.connectionJournal.unknownAccountHint') : undefined}>
            {entry.username}
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
        {unknownAccount && <Badge variant="warning" className="ml-2">{t('pages.connectionJournal.unknownAccount')}</Badge>}
      </td>
      <td className="px-3 py-2.5 align-middle whitespace-nowrap">
        <button
          type="button"
          className="inline-flex items-center gap-1 font-mono-data hover:text-primary transition-colors"
          title={t('pages.connectionJournal.filterByAddress')}
          onClick={() => onFilterIp(entry.ip)}
        >
          {entry.ip}
          <Filter className="h-3 w-3 opacity-40" />
        </button>
      </td>
      <td className="px-3 py-2.5 align-middle text-xs">
        {entry.reason && <div>{t(`pages.connectionJournal.reason.${entry.reason}`)}</div>}
        {entry.userAgent && (
          <div className="text-muted-foreground" title={entry.userAgent}>
            {device ?? entry.userAgent.slice(0, 40)}
          </div>
        )}
      </td>
    </tr>
  );
}
