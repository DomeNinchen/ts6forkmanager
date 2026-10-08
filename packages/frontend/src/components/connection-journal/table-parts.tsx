import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type SortOrder = 'asc' | 'desc';

/** A column header that asks the server for the list sorted by it; the page decides which way a first click sorts and flips it on a second. */
export function SortHeader<C extends string>({
  column, label, sort, order, onSort, className,
}: {
  column: C;
  label: string;
  sort: C;
  order: SortOrder;
  onSort: (column: C) => void;
  className?: string;
}) {
  const active = sort === column;
  return (
    <th
      className={cn('h-10 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors', className)}
      onClick={() => onSort(column)}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <div className="flex items-center gap-1">
        {label}
        <span className="ml-1">
          {active ? (order === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-30" />}
        </span>
      </div>
    </th>
  );
}

export function Pager({
  page, pageSize, total, onPage, extra,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">{t('pages.connectionJournal.resultCount', { count: total })}</p>
      <div className="flex items-center gap-2">
        {extra}
        <Button variant="outline" size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          {t('components.dataTable.previous')}
        </Button>
        <span className="text-xs text-muted-foreground font-mono-data" data-testid="journal-page">
          {page} / {pages}
        </span>
        <Button variant="outline" size="sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          {t('components.dataTable.next')}
        </Button>
      </div>
    </div>
  );
}
