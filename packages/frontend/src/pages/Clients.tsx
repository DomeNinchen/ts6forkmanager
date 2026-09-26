import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useClients, useKickClient, useBanClient, usePokeClient,
  useBulkMoveClients, useBulkKickClients, useBulkBanClients, useBulkDescribeClients,
} from '@/hooks/use-clients';
import { useChannels } from '@/hooks/use-channels';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { DataTable, type DataTableFeatures } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatUptime } from '@/lib/utils';
import { Users, MoreHorizontal, LogOut, Ban, MessageSquare, Zap, ArrowRightLeft, Pencil, X } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

type BulkDialog = 'move' | 'kick' | 'ban' | 'describe' | null;

export default function Clients() {
  const { t } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data, isLoading } = useClients();
  const { data: channelData } = useChannels();
  const kickClient = useKickClient();
  const banClient = useBanClient();
  const pokeClient = usePokeClient();
  const bulkMove = useBulkMoveClients();
  const bulkKick = useBulkKickClients();
  const bulkBan = useBulkBanClients();
  const bulkDescribe = useBulkDescribeClients();

  const [pokeTarget, setPokeTarget] = useState<{ clid: number; name: string } | null>(null);
  const [pokeMsg, setPokeMsg] = useState('');

  const [selected, setSelected] = useState<any[]>([]);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null);
  const [bulkTargetChannel, setBulkTargetChannel] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBanTime, setBulkBanTime] = useState('3600');
  const [bulkDescription, setBulkDescription] = useState('');

  const channels = Array.isArray(channelData) ? channelData : [];
  const selectedClids = selected.map((c) => Number(c.clid));

  const closeBulkDialog = () => {
    setBulkDialog(null);
    setBulkTargetChannel('');
    setBulkReason('');
    setBulkDescription('');
  };

  const clients = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    return data.filter((c: any) => String(c.client_type) === '0');
  }, [data]);

  const columns: ColumnDef<DataTableFeatures, any>[] = useMemo(() => {
    const cols: ColumnDef<DataTableFeatures, any>[] = [
      {
        accessorKey: 'client_nickname',
        header: t('pages.clients.nickname'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-mono-data text-primary">
              {row.original.client_nickname?.[0]?.toUpperCase() || '?'}
            </div>
            <span className="font-medium">{row.original.client_nickname}</span>
          </div>
        ),
      },
      {
        accessorKey: 'client_country',
        header: t('pages.clients.country'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs">{(getValue() as string) || '-'}</span>,
      },
      {
        accessorKey: 'client_idle_time',
        header: t('pages.clients.idle'),
        cell: ({ getValue }) => <span className="font-mono-data text-xs text-muted-foreground">{formatUptime(Math.floor((getValue() as number) / 1000))}</span>,
      },
      {
        accessorKey: 'client_away',
        header: t('common.status'),
        cell: ({ row }) => {
          if (row.original.client_away) return <Badge variant="warning" className="text-[10px]">{t('pages.clients.away')}</Badge>;
          if (row.original.client_input_muted) return <Badge variant="secondary" className="text-[10px]">{t('pages.clients.muted')}</Badge>;
          return <Badge variant="success" className="text-[10px]">{t('common.active')}</Badge>;
        },
      },
    ];
    if (isAdmin) {
      cols.push({
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const c = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setPokeTarget({ clid: c.clid, name: c.client_nickname }); setPokeMsg(''); }}>
                  <Zap className="mr-2 h-4 w-4" /> {t('pages.clients.poke')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  kickClient.mutate({ clid: c.clid, reasonid: 5, reasonmsg: 'Kicked by admin' });
                  toast.success(t('pages.clients.kickedName', { name: c.client_nickname }));
                }}>
                  <LogOut className="mr-2 h-4 w-4" /> {t('pages.clients.kickFromServer')}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => {
                  banClient.mutate({ clid: c.clid, time: 3600, banreason: 'Banned by admin' });
                  toast.success(t('pages.clients.bannedName', { name: c.client_nickname }));
                }}>
                  <Ban className="mr-2 h-4 w-4" /> {t('pages.clients.banOneHour')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, kickClient, banClient, t]);

  if (!selectedConfigId || !selectedSid) return <EmptyState icon={Users} title={t('pages.noServerSelected')} />;
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('nav.items.clients')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('pages.clients.onlineCount', { count: clients.length })}</p>
        </div>
      </div>

      {isAdmin && selected.length > 0 && (
        <div className="card-hero flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium">{t('pages.clients.selectedCount', { count: selected.length })}</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setBulkDialog('move')}>
            <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" /> {t('pages.clients.move')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkDialog('kick')}>
            <LogOut className="h-3.5 w-3.5 mr-1.5" /> {t('pages.clients.kick')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkDialog('ban')}>
            <Ban className="h-3.5 w-3.5 mr-1.5" /> {t('pages.clients.ban')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBulkDialog('describe')}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> {t('pages.clients.describe')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            <X className="h-3.5 w-3.5 mr-1.5" /> {t('common.clear')}
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={clients}
        searchKey="client_nickname"
        searchPlaceholder={t('pages.clients.searchPlaceholder')}
        enableRowSelection={isAdmin}
        getRowId={(c: any) => String(c.clid)}
        onSelectionChange={setSelected}
      />

      {/* Poke Dialog */}
      <Dialog open={!!pokeTarget} onOpenChange={() => setPokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pages.clients.pokeName', { name: pokeTarget?.name })}</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs">{t('pages.messages.message')}</Label>
            <Input value={pokeMsg} onChange={(e) => setPokeMsg(e.target.value)} placeholder={t('pages.clients.pokePlaceholder')} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPokeTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={() => {
              if (pokeTarget && pokeMsg) {
                pokeClient.mutate({ clid: pokeTarget.clid, msg: pokeMsg });
                toast.success(t('pages.clients.pokedName', { name: pokeTarget.name }));
                setPokeTarget(null);
              }
            }}>
              <Zap className="h-4 w-4 mr-1" /> {t('pages.clients.poke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Move Dialog */}
      <Dialog open={bulkDialog === 'move'} onOpenChange={(o) => !o && closeBulkDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pages.clients.moveCount', { count: selected.length })}</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs">{t('pages.clients.targetChannel')}</Label>
            <Select value={bulkTargetChannel} onValueChange={setBulkTargetChannel}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t('pages.clients.chooseChannel')} /></SelectTrigger>
              <SelectContent>
                {channels.map((ch: any) => <SelectItem key={ch.cid} value={String(ch.cid)}>{ch.channel_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBulkDialog}>{t('common.cancel')}</Button>
            <Button
              disabled={!bulkTargetChannel || bulkMove.isPending}
              onClick={() => bulkMove.mutate({ clids: selectedClids, cid: Number(bulkTargetChannel) }, {
                onSuccess: () => { toast.success(t('pages.clients.movedCount', { count: selected.length })); setSelected([]); closeBulkDialog(); },
                onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.clients.moveFailed')),
              })}
            >
              <ArrowRightLeft className="h-4 w-4 mr-1" /> {t('pages.clients.move')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Kick Dialog */}
      <Dialog open={bulkDialog === 'kick'} onOpenChange={(o) => !o && closeBulkDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pages.clients.kickCount', { count: selected.length })}</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs">{t('pages.clients.reasonOptional')}</Label>
            <Input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder={t('pages.clients.kickedByAdmin')} className="mt-1" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBulkDialog}>{t('common.cancel')}</Button>
            <Button
              disabled={bulkKick.isPending}
              onClick={() => bulkKick.mutate({ clids: selectedClids, reasonid: 5, reasonmsg: bulkReason || undefined }, {
                onSuccess: () => { toast.success(t('pages.clients.kickedCount', { count: selected.length })); setSelected([]); closeBulkDialog(); },
                onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.clients.kickFailed')),
              })}
            >
              <LogOut className="h-4 w-4 mr-1" /> {t('pages.clients.kickFromServer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Ban Dialog */}
      <Dialog open={bulkDialog === 'ban'} onOpenChange={(o) => !o && closeBulkDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pages.clients.banCount', { count: selected.length })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('pages.clients.durationSeconds')}</Label>
              <Input type="number" value={bulkBanTime} onChange={(e) => setBulkBanTime(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pages.bans.reason')}</Label>
              <Input value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder={t('pages.clients.bannedByAdmin')} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBulkDialog}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              disabled={bulkBan.isPending}
              onClick={() => bulkBan.mutate({ clids: selectedClids, time: Number(bulkBanTime) || 0, banreason: bulkReason || undefined }, {
                onSuccess: () => { toast.success(t('pages.clients.bannedCount', { count: selected.length })); setSelected([]); closeBulkDialog(); },
                onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.clients.banFailed')),
              })}
            >
              <Ban className="h-4 w-4 mr-1" /> {t('pages.clients.ban')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Describe Dialog */}
      <Dialog open={bulkDialog === 'describe'} onOpenChange={(o) => !o && closeBulkDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pages.clients.describeCount', { count: selected.length })}</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs">{t('pages.clients.descriptionApplied')}</Label>
            <Textarea value={bulkDescription} onChange={(e) => setBulkDescription(e.target.value)} rows={2} className="mt-1" maxLength={200} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBulkDialog}>{t('common.cancel')}</Button>
            <Button
              disabled={!bulkDescription.trim() || bulkDescribe.isPending}
              onClick={() => bulkDescribe.mutate({ clids: selectedClids, description: bulkDescription.trim() }, {
                onSuccess: () => { toast.success(t('pages.clients.descriptionUpdated', { count: selected.length })); setSelected([]); closeBulkDialog(); },
                onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.clients.descriptionUpdateFailed')),
              })}
            >
              <Pencil className="h-4 w-4 mr-1" /> {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
