import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { complaintsApi } from '@/api/bans.api';
import { useServerStore } from '@/stores/server.store';
import { DataTable, type DataTableFeatures } from '@/components/shared/DataTable';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { MessageSquareWarning } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { timeAgo } from '@/lib/utils';

export default function Complaints() {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const { data, isLoading } = useQuery({ queryKey: ['complaints', c, s], queryFn: () => complaintsApi.list(c!, s!), enabled: !!c && !!s });

  const complaints = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const columns: ColumnDef<DataTableFeatures, any>[] = useMemo(() => [
    { accessorKey: 'fname', header: t('pages.complaints.from') },
    { accessorKey: 'tname', header: t('pages.complaints.about') },
    { accessorKey: 'message', header: t('common.description') },
    { accessorKey: 'timestamp', header: t('pages.complaints.when'), cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{timeAgo(getValue() as number)}</span> },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t]);

  if (!c || !s) return <EmptyState icon={MessageSquareWarning} title={t('pages.noServerSelected')} />;
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('nav.items.complaints')}</h1>
      <DataTable columns={columns} data={complaints} searchKey="message" searchPlaceholder={t('pages.complaints.searchPlaceholder')} />
    </div>
  );
}
