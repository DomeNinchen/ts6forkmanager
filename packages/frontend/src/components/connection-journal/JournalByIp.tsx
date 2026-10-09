import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ban as BanIcon, Filter } from 'lucide-react';
import type { JournalIpSortColumn } from '@ts6/common';
import { connectionJournalApi } from '@/api/connection-journal.api';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { BanBadges } from './BanBadges';
import type { BanTarget } from './BanDialog';
import { CountryCell } from './CountryCell';
import { PAGE_SIZE_OPTIONS } from './format';
import { toQuery, type JournalFilterState } from './filters';
import { Pager, SortHeader, type SortOrder } from './table-parts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** The journal with one line per address: how often it came, how often it failed, how many accounts it tried. */
export function JournalByIp({
  filters, onFilterIp, onBan,
}: {
  filters: JournalFilterState;
  /** Clicking an address opens the journal narrowed to it. */
  onFilterIp: (ip: string) => void;
  /** The ban button of a row. */
  onBan: (target: BanTarget) => void;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<JournalIpSortColumn>('lastAt');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const query = toQuery(filters, page, pageSize);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['connection-journal', 'by-ip', query, sort, order],
    queryFn: () => connectionJournalApi.byIp({ ...query, sort, order }),
    placeholderData: keepPreviousData,
  });

  const [seenFilters, setSeenFilters] = useState(filters);
  if (seenFilters !== filters) {
    setSeenFilters(filters);
    setPage(1);
  }

  const onSort = (column: JournalIpSortColumn) => {
    if (column === sort) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(column);
      setOrder(column === 'ip' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  if (isLoading) return <PageLoader />;
  if (isError || !data) return <p className="text-sm text-destructive">{t('pages.connectionJournal.loadFailed')}</p>;

  return (
    <div className="space-y-3">
      <div className="card-hero rounded-md border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <SortHeader column="ip" label={t('pages.connectionJournal.columns.address')} sort={sort} order={order} onSort={onSort} />
              <SortHeader column="country" label={t('pages.connectionJournal.columns.country')} sort={sort} order={order} onSort={onSort} />
              <SortHeader column="total" label={t('pages.connectionJournal.columns.entries')} sort={sort} order={order} onSort={onSort} />
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">{t('pages.connectionJournal.columns.failures')}</th>
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">{t('pages.connectionJournal.columns.successes')}</th>
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">{t('pages.connectionJournal.columns.accountsTried')}</th>
              <SortHeader column="lastAt" label={t('pages.connectionJournal.columns.lastSeen')} sort={sort} order={order} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="h-24 text-center text-muted-foreground">{t('pages.connectionJournal.empty')}</td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.ip} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors" data-testid="journal-ip-row">
                  <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-mono-data hover:text-primary transition-colors"
                        title={t('pages.connectionJournal.showEntries')}
                        onClick={() => onFilterIp(row.ip)}
                      >
                        {row.ip}
                        <Filter className="h-3 w-3 opacity-40" />
                      </button>
                      {row.ip !== 'unknown' && (
                        <button
                          type="button"
                          className="text-muted-foreground opacity-50 hover:opacity-100 hover:text-destructive transition-colors"
                          title={t('pages.connectionJournal.ban.banThis')}
                          aria-label={t('pages.connectionJournal.ban.banThis')}
                          data-testid="journal-ban"
                          onClick={() => onBan({ ip: row.ip, webBan: row.webBan })}
                        >
                          <BanIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <BanBadges web={row.webBan} />
                  </td>
                  <td className="px-3 py-2.5 align-middle text-xs"><CountryCell country={row.country} city={row.city} scope={row.scope} /></td>
                  <td className="px-3 py-2.5 align-middle font-mono-data">{row.total}</td>
                  <td className={row.failures > 0 ? 'px-3 py-2.5 align-middle font-mono-data text-destructive' : 'px-3 py-2.5 align-middle font-mono-data'}>{row.failures}</td>
                  <td className="px-3 py-2.5 align-middle font-mono-data">{row.successes}</td>
                  <td className="px-3 py-2.5 align-middle font-mono-data">{row.usernames}</td>
                  <td className="px-3 py-2.5 align-middle whitespace-nowrap font-mono-data text-xs">{new Date(row.lastAt).toLocaleString()}</td>
                </tr>
              ))
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
