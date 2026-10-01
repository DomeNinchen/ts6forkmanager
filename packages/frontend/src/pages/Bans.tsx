import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useBans, useAddBan, useDeleteBan } from '@/hooks/use-bans';
import { useServerStore } from '@/stores/server.store';
import { DataTable, type DataTableFeatures } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDuration, timeAgo } from '@/lib/utils';
import { Ban, Plus, Trash2 } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

export default function Bans() {
  const { t } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const { data, isLoading } = useBans();
  const addBan = useAddBan();
  const deleteBan = useDeleteBan();
  const [showAdd, setShowAdd] = useState(false);
  const [banType, setBanType] = useState<'ip' | 'name' | 'uid'>('ip');
  const [banValue, setBanValue] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState('3600');

  const bans = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const columns: ColumnDef<DataTableFeatures, any>[] = useMemo(() => [
    { accessorKey: 'lastnickname', header: t('pages.bans.lastNickname'), cell: ({ getValue }) => <span className="font-medium">{(getValue() as string) || '-'}</span> },
    { accessorKey: 'ip', header: 'IP', cell: ({ getValue }) => <span className="font-mono-data text-xs">{(getValue() as string) || '-'}</span> },
    { accessorKey: 'uid', header: 'UID', cell: ({ getValue }) => <span className="font-mono-data text-xs truncate max-w-[120px] block">{(getValue() as string) || '-'}</span> },
    { accessorKey: 'name', header: t('pages.bans.nameRegex'), cell: ({ getValue }) => <span className="font-mono-data text-xs truncate max-w-[160px] block" title={getValue() as string}>{(getValue() as string) || '-'}</span> },
    { accessorKey: 'reason', header: t('pages.bans.reason'), cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '-'}</span> },
    { accessorKey: 'duration', header: t('pages.bans.duration'), cell: ({ getValue }) => <span className="font-mono-data text-xs">{formatDuration(getValue() as number)}</span> },
    { accessorKey: 'created', header: t('pages.bans.created'), cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{timeAgo(getValue() as number)}</span> },
    { accessorKey: 'invokername', header: t('pages.bans.by'), cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '-'}</span> },
    {
      id: 'actions', header: '',
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => {
          deleteBan.mutate(row.original.banid, { onSuccess: () => toast.success(t('pages.bans.removed')) });
        }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [deleteBan, t]);

  if (!selectedConfigId || !selectedSid) return <EmptyState icon={Ban} title={t('pages.noServerSelected')} />;
  if (isLoading) return <PageLoader />;

  const handleAdd = () => {
    const params: any = { time: parseInt(banDuration), banreason: banReason };
    params[banType] = banValue;
    addBan.mutate(params, {
      onSuccess: () => { toast.success(t('pages.bans.added')); setShowAdd(false); setBanValue(''); setBanReason(''); },
      onError: () => toast.error(t('pages.bans.addFailed')),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('nav.items.bans')}</h1>
        <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> {t('pages.bans.addBan')}</Button>
      </div>

      <DataTable columns={columns} data={bans} searchKey="lastnickname" searchPlaceholder={t('pages.bans.searchPlaceholder')} />

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.bans.addBan')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('pages.bans.banType')}</Label>
              <Select value={banType} onValueChange={(v: any) => setBanType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ip">{t('pages.bans.ipAddress')}</SelectItem>
                  <SelectItem value="name">{t('pages.bans.nameRegex')}</SelectItem>
                  <SelectItem value="uid">{t('pages.bans.uniqueId')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">{t('pages.bans.value')}</Label><Input value={banValue} onChange={(e) => setBanValue(e.target.value)} placeholder={banType === 'ip' ? '192.168.1.*' : banType === 'name' ? '.*bad.*' : 'unique-id'} /></div>
            <div><Label className="text-xs">{t('pages.bans.reason')}</Label><Input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder={t('pages.bans.reasonPlaceholder')} /></div>
            <div>
              <Label className="text-xs">{t('pages.bans.duration')}</Label>
              <Select value={banDuration} onValueChange={setBanDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3600">{t('pages.bans.oneHour')}</SelectItem>
                  <SelectItem value="86400">{t('pages.bans.oneDay')}</SelectItem>
                  <SelectItem value="604800">{t('pages.bans.oneWeek')}</SelectItem>
                  <SelectItem value="2592000">{t('pages.bans.thirtyDays')}</SelectItem>
                  <SelectItem value="0">{t('common.duration.permanent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleAdd} disabled={!banValue}>{t('pages.bans.addBan')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
