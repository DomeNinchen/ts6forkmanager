import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { normalizeIconId } from '@ts6/common';
import { IconImage } from '@/components/icons/IconImage';
import { useChannelGroups, useCreateChannelGroup, useDeleteChannelGroup } from '@/hooks/use-groups';
import { groupsApi } from '@/api/groups.api';
import { permissionsApi } from '@/api/permissions.api';
import { clientsApi } from '@/api/clients.api';
import { channelsApi } from '@/api/channels.api';
import { useServerStore } from '@/stores/server.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { tsErrorMessage } from '@/lib/ts-errors';
import { ShieldCheck, Search, User, Plus, Trash2, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

export default function ChannelGroups() {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const qc = useQueryClient();
  const { data, isLoading } = useChannelGroups();
  const createGroup = useCreateChannelGroup();
  const deleteGroup = useDeleteChannelGroup();

  const [tab, setTab] = useState<'groups' | 'by-client'>('groups');
  const [selectedClient, setSelectedClient] = useState<{ cldbid: number; name: string } | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showOffline, setShowOffline] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  // By Client tab: which of the selected client's channels are ticked for a
  // bulk group change, and the group to move them all to.
  const [checkedChannels, setCheckedChannels] = useState<Set<number>>(new Set());
  const [bulkCgid, setBulkCgid] = useState('');
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleChecked = (cgid: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(cgid) ? next.delete(cgid) : next.add(cgid);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const results = await Promise.allSettled([...checkedIds].map((cgid) => deleteGroup.mutateAsync(cgid)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    setBulkDeleting(false);
    setShowBulkDelete(false);
    if (failed > 0) toast.error(t('pages.channelGroups.bulkDeletePartial', { succeeded: results.length - failed, failed }));
    else toast.success(t('pages.channelGroups.bulkDeleteSuccess', { count: results.length }));
    setCheckedIds(new Set());
  };

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!c || !s) return;
    setExporting(true);
    try {
      const targets = (Array.isArray(data) ? data : []).filter((g: any) => checkedIds.has(g.cgid));
      const exported = await Promise.all(targets.map(async (g: any) => {
        const perms = await permissionsApi.channelGroupPerms(c, s, g.cgid);
        return {
          name: g.name,
          type: Number(g.type),
          permissions: (Array.isArray(perms) ? perms : []).map((p: any) => ({
            permsid: p.permsid, permvalue: Number(p.permvalue) || 0,
            permnegated: Number(p.permnegated) || 0, permskip: Number(p.permskip) || 0,
          })),
        };
      }));
      const payload = { format: 'ts6manager-group-export', version: 1, groupType: 'channel', exportedAt: new Date().toISOString(), groups: exported };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `channel-groups-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('pages.channelGroups.exportedCount', { count: exported.length }));
    } catch {
      toast.error(t('pages.channelGroups.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    if (!c || !s) return;
    setImporting(true);
    try {
      let payload: any;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        toast.error(t('pages.channelGroups.invalidJson'));
        return;
      }
      if (payload.format !== 'ts6manager-group-export' || !Array.isArray(payload.groups)) {
        toast.error(t('pages.channelGroups.notValidGroupExport'));
        return;
      }
      if (payload.groupType !== 'channel') {
        toast.error(payload.groupType === 'server'
          ? t('pages.channelGroups.wrongExportTypeServer')
          : t('pages.channelGroups.notValidChannelExport'));
        return;
      }
      if (payload.groups.length === 0) {
        toast.error(t('pages.channelGroups.emptyExportFile'));
        return;
      }

      let imported = 0;
      let permCount = 0;
      let permFailed = 0;
      const skipped: string[] = [];
      for (const g of payload.groups) {
        let cgid: number;
        try {
          const created = await createGroup.mutateAsync(g.name);
          cgid = Number(created?.[0]?.cgid ?? created?.cgid);
        } catch (err) {
          skipped.push(`"${g.name}" (${tsErrorMessage(err, t('pages.channelGroups.createFailedFallback'), t)})`);
          continue;
        }
        imported++;
        for (const p of g.permissions || []) {
          try {
            await permissionsApi.addChannelGroupPerm(c, s, cgid, p);
            permCount++;
          } catch {
            permFailed++;
          }
        }
      }

      if (imported === 0) {
        toast.error(t('pages.channelGroups.importFailed', { reason: skipped[0] || t('pages.channelGroups.importFailedNoGroups') }));
        return;
      }
      let msg = t('pages.channelGroups.importSummary', { imported, total: payload.groups.length, permCount });
      if (permFailed > 0) msg += t('pages.channelGroups.importPermSkipped', { count: permFailed });
      if (skipped.length > 0) msg += t('pages.channelGroups.importSkippedList', { list: skipped.join(', ') });
      if (skipped.length > 0 || permFailed > 0) toast.warning(msg);
      else toast.success(msg);
    } finally {
      setImporting(false);
    }
  };

  const { data: onlineClients } = useQuery({
    queryKey: ['clients-for-cg', c, s],
    queryFn: () => clientsApi.list(c!, s!),
    enabled: !!c && !!s && tab === 'by-client',
  });
  const { data: offlineClients } = useQuery({
    queryKey: ['clients-db-for-cg', c, s],
    queryFn: () => clientsApi.database(c!, s!, 0, 500),
    enabled: !!c && !!s && tab === 'by-client' && showOffline,
  });
  const { data: channelData } = useQuery({
    queryKey: ['channels-for-cg', c, s],
    queryFn: () => channelsApi.list(c!, s!),
    enabled: !!c && !!s && tab === 'by-client',
  });
  const { data: clientGroups, isLoading: loadingClientGroups } = useQuery({
    queryKey: ['channel-groups-by-client', c, s, selectedClient?.cldbid],
    queryFn: () => groupsApi.channelGroupsByClient(c!, s!, selectedClient!.cldbid),
    enabled: !!c && !!s && !!selectedClient,
  });

  const assignMutation = useMutation({
    mutationFn: ({ cgid, cid }: { cgid: number; cid: number }) => groupsApi.assignChannelGroup(c!, s!, cgid, cid, selectedClient!.cldbid),
    onSuccess: () => {
      toast.success(t('pages.channelGroups.channelGroupUpdated'));
      qc.invalidateQueries({ queryKey: ['channel-groups-by-client'] });
    },
    onError: () => toast.error(t('pages.channelGroups.channelGroupUpdateFailed')),
  });

  // Bulk-assign: put several of this client's channels on the same group at
  // once. Scoped to channels they already have an assignment in, since that's
  // all TeamSpeak reports here (it only tracks genuine non-default overrides).
  const bulkAssignMutation = useMutation({
    mutationFn: async ({ cgid, cids }: { cgid: number; cids: number[] }) => {
      for (const cid of cids) await groupsApi.assignChannelGroup(c!, s!, cgid, cid, selectedClient!.cldbid);
      return cids.length;
    },
    onSuccess: (n) => {
      toast.success(t('pages.channelGroups.channelGroupsUpdatedForCount', { count: n }));
      setCheckedChannels(new Set());
      setBulkCgid('');
      qc.invalidateQueries({ queryKey: ['channel-groups-by-client'] });
    },
    onError: () => toast.error(t('pages.channelGroups.channelGroupsUpdateFailed')),
  });

  const clientCandidates = useMemo(() => {
    const online = (Array.isArray(onlineClients) ? onlineClients : [])
      .filter((cl: any) => String(cl.client_type) === '0')
      .map((cl: any) => ({ cldbid: Number(cl.client_database_id), name: cl.client_nickname, online: true }));
    if (!showOffline) return online;
    const onlineIds = new Set(online.map((o) => o.cldbid));
    const offline = (Array.isArray(offlineClients) ? offlineClients : [])
      .filter((cl: any) => !onlineIds.has(Number(cl.cldbid)))
      .map((cl: any) => ({ cldbid: Number(cl.cldbid), name: cl.client_nickname || t('pages.channelGroups.clientFallback', { id: cl.cldbid }), online: false }));
    return [...online, ...offline].sort((a, b) =>
      a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1);
  }, [onlineClients, offlineClients, showOffline])
    .filter((cl) => !clientSearch || cl.name.toLowerCase().includes(clientSearch.toLowerCase()));

  const channels = useMemo(() => {
    if (!Array.isArray(channelData)) return [];
    return channelData.map((ch: any) => ({ cid: Number(ch.cid), name: ch.channel_name }));
  }, [channelData]);

  const groups = Array.isArray(data) ? data : [];
  const assignments = Array.isArray(clientGroups) ? clientGroups : [];
  // Only regular groups (type 1) can actually be assigned to a client -
  // TeamSpeak rejects its own built-in template groups with "invalid group
  // ID" (2560), confirmed live - so they have no business being offered here.
  const assignableGroups = groups.filter((g: any) => Number(g.type) === 1);

  if (!c || !s) return <EmptyState icon={ShieldCheck} title={t('pages.noServerSelected')} />;
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('nav.items.channelGroups')}</h1>
        {tab === 'groups' && (
          <div className="flex items-center gap-2">
            {checkedIds.size > 0 && (
              <>
                <Badge variant="secondary" className="font-mono-data">{t('pages.channelGroups.selectedCount', { count: checkedIds.size })}</Badge>
                <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                  <Download className="h-3.5 w-3.5 mr-1" /> {t('pages.channelGroups.exportSelected')}
                </Button>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowBulkDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> {t('pages.channelGroups.deleteSelected')}
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              <Upload className="h-3.5 w-3.5 mr-1" /> {t('pages.channelGroups.import')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
            />
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" /> {t('pages.channelGroups.createGroup')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-1 p-1 bg-muted/30 rounded-lg w-fit">
        <button
          onClick={() => setTab('groups')}
          className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', tab === 'groups' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
        >
          {t('pages.channelGroups.tabGroups')}
        </button>
        <button
          onClick={() => setTab('by-client')}
          className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', tab === 'by-client' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
        >
          {t('pages.channelGroups.tabByClient')}
        </button>
      </div>

      {tab === 'groups' ? (
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('pages.channelGroups.groupsHeading', { count: groups.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="space-y-1">
                {groups.map((g: any) => (
                  <div key={g.cgid} className="flex items-center justify-between rounded-md px-3 py-2.5 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={checkedIds.has(g.cgid)}
                        onCheckedChange={() => toggleChecked(g.cgid)}
                        aria-label={t('pages.channelGroups.selectForBulkDelete')}
                      />
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{g.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <IconImage iconId={normalizeIconId(g.iconid)} size={16} alt={t('pages.channelGroups.iconAlt', { name: g.name })} />
                      <Badge variant="secondary" className="text-[10px] font-mono-data">{t('pages.channelGroups.cgidLabel', { id: g.cgid })}</Badge>
                      <Badge variant="outline" className="text-[10px] font-mono-data">{t('pages.channelGroups.typeLabel', { type: g.type })}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          <Card className="card-hero col-span-4">
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('pages.channelGroups.selectClient')}</CardTitle>
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder={t('pages.channelGroups.searchClientsPlaceholder')} className="h-7 pl-7 text-xs" />
              </div>
              <div className="flex items-center gap-1.5">
                <Switch id="cg-show-offline" checked={showOffline} onCheckedChange={setShowOffline} />
                <Label htmlFor="cg-show-offline" className="text-xs text-muted-foreground cursor-pointer">{t('pages.channelGroups.showOfflineClients')}</Label>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[440px]">
                <div className="p-2 space-y-0.5">
                  {clientCandidates.map((cl) => (
                    <button
                      key={cl.cldbid}
                      onClick={() => { setSelectedClient({ cldbid: cl.cldbid, name: cl.name }); setCheckedChannels(new Set()); setBulkCgid(''); }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2',
                        selectedClient?.cldbid === cl.cldbid ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50',
                      )}
                    >
                      {showOffline && (
                        <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', cl.online ? 'bg-emerald-500' : 'bg-zinc-500')} title={cl.online ? t('common.online') : t('common.offline')} />
                      )}
                      <span className="truncate">{cl.name}</span>
                    </button>
                  ))}
                  {clientCandidates.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">{t('pages.channelGroups.noClientsFound')}</p>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="card-hero col-span-8">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {selectedClient ? t('pages.channelGroups.clientChannelGroupsHeading', { name: selectedClient.name }) : t('pages.channelGroups.selectAClient')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!selectedClient ? (
                <div className="flex items-center justify-center h-[400px]">
                  <p className="text-sm text-muted-foreground">{t('pages.channelGroups.selectClientHint')}</p>
                </div>
              ) : loadingClientGroups ? (
                <div className="flex items-center justify-center h-[400px]"><PageLoader /></div>
              ) : assignments.length === 0 ? (
                <div className="flex items-center justify-center h-[400px]">
                  <EmptyState icon={User} title={t('pages.channelGroups.noAssignmentsTitle')} description={t('pages.channelGroups.noAssignmentsDescription')} />
                </div>
              ) : (
                <div className="px-3 pb-3">
                  {checkedChannels.size > 0 && (
                    <div className="flex items-center gap-2 px-2 py-2 mb-1 rounded-md bg-muted/30">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {t('pages.channelGroups.channelsSelectedCount', { count: checkedChannels.size })}
                      </span>
                      <Select value={bulkCgid} onValueChange={setBulkCgid}>
                        <SelectTrigger className="h-8 text-xs w-56"><SelectValue placeholder={t('pages.channelGroups.moveAllToPlaceholder')} /></SelectTrigger>
                        <SelectContent>
                          {assignableGroups.map((g: any) => (
                            <SelectItem key={g.cgid} value={String(g.cgid)}>
                              <span className="flex items-center gap-1.5">
                                <IconImage iconId={normalizeIconId(g.iconid)} size={14} alt={t('pages.channelGroups.iconAlt', { name: g.name })} />
                                {g.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        disabled={!bulkCgid || bulkAssignMutation.isPending}
                        onClick={() => bulkAssignMutation.mutate({ cgid: Number(bulkCgid), cids: [...checkedChannels] })}
                      >
                        {t('pages.channelGroups.applyToCount', { count: checkedChannels.size })}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setCheckedChannels(new Set())}>
                        {t('common.clear')}
                      </Button>
                    </div>
                  )}
                  <div className="grid grid-cols-12 gap-2 px-2 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider items-center">
                    <div className="col-span-1">
                      <Checkbox
                        checked={assignments.length > 0 && checkedChannels.size === assignments.length}
                        onCheckedChange={(v) =>
                          setCheckedChannels(v ? new Set(assignments.map((a: any) => Number(a.cid))) : new Set())
                        }
                        aria-label={t('pages.channelGroups.selectAllChannels')}
                      />
                    </div>
                    <div className="col-span-5">{t('pages.channelGroups.colChannel')}</div>
                    <div className="col-span-6">{t('pages.channelGroups.colChannelGroup')}</div>
                  </div>
                  {assignments.map((a: any) => {
                    const cid = Number(a.cid);
                    const currentCgid = String(Number(a.cgid));
                    return (
                      <div key={cid} className="grid grid-cols-12 gap-2 px-2 py-1.5 rounded-sm text-sm items-center hover:bg-muted/20">
                        <div className="col-span-1">
                          <Checkbox
                            checked={checkedChannels.has(cid)}
                            onCheckedChange={() =>
                              setCheckedChannels((prev) => {
                                const next = new Set(prev);
                                next.has(cid) ? next.delete(cid) : next.add(cid);
                                return next;
                              })
                            }
                            aria-label={t('pages.channelGroups.selectChannelForBulk')}
                          />
                        </div>
                        <div className="col-span-5 truncate">{channels.find((ch) => ch.cid === cid)?.name || `#${cid}`}</div>
                        <div className="col-span-6">
                          <Select
                            value={currentCgid}
                            onValueChange={(v) => assignMutation.mutate({ cgid: Number(v), cid })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {assignableGroups.map((g: any) => (
                                <SelectItem key={g.cgid} value={String(g.cgid)}>
                                  <span className="flex items-center gap-1.5">
                                    <IconImage iconId={normalizeIconId(g.iconid)} size={14} alt={t('pages.channelGroups.iconAlt', { name: g.name })} />
                                    {g.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.channelGroups.createChannelGroupTitle')}</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">{t('pages.channelGroups.groupNameLabel')}</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('pages.channelGroups.newGroupPlaceholder')} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => createGroup.mutate(newName, { onSuccess: () => { toast.success(t('pages.channelGroups.groupCreated')); setShowCreate(false); setNewName(''); } })}
              disabled={!newName.trim() || createGroup.isPending}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showBulkDelete}
        onOpenChange={setShowBulkDelete}
        title={t('pages.channelGroups.deleteChannelGroupsTitle')}
        description={t('pages.channelGroups.bulkDeleteDescription', { count: checkedIds.size })}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={handleBulkDelete}
        loading={bulkDeleting}
      />
    </div>
  );
}
