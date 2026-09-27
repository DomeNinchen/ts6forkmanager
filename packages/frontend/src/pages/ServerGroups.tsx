import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeIconId } from '@ts6/common';
import { IconImage } from '@/components/icons/IconImage';
import {
  useServerGroups, useServerGroupMembers, useCreateServerGroup, useDeleteServerGroup,
  useAddServerGroupMember, useRemoveServerGroupMember,
} from '@/hooks/use-groups';
import { useClientDatabase } from '@/hooks/use-clients';
import { permissionsApi } from '@/api/permissions.api';
import { useServerStore } from '@/stores/server.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { tsErrorMessage } from '@/lib/ts-errors';
import { Shield, Plus, Trash2, Users, ChevronRight, UserPlus, X, Search, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

export default function ServerGroups() {
  const { t } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const { data, isLoading } = useServerGroups();
  const createGroup = useCreateServerGroup();
  const deleteGroup = useDeleteServerGroup();
  const addMember = useAddServerGroupMember();
  const removeMember = useRemoveServerGroupMember();
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const { data: members } = useServerGroupMembers(selectedGroup);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ sgid: number; name: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const { data: dbClients } = useClientDatabase();
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleChecked = (sgid: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(sgid) ? next.delete(sgid) : next.add(sgid);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const results = await Promise.allSettled([...checkedIds].map((sgid) => deleteGroup.mutateAsync(sgid)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    setBulkDeleting(false);
    setShowBulkDelete(false);
    if (failed > 0) toast.error(t('pages.serverGroups.bulkDeletePartial', { succeeded: results.length - failed, failed }));
    else toast.success(t('pages.serverGroups.bulkDeleteSuccess', { count: results.length }));
    if (checkedIds.has(selectedGroup!)) setSelectedGroup(null);
    setCheckedIds(new Set());
  };

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!selectedConfigId || !selectedSid) return;
    setExporting(true);
    try {
      const targets = groups.filter((g: any) => checkedIds.has(g.sgid));
      const exported = await Promise.all(targets.map(async (g: any) => {
        const perms = await permissionsApi.serverGroupPerms(selectedConfigId, selectedSid, g.sgid);
        return {
          name: g.name,
          type: Number(g.type),
          permissions: (Array.isArray(perms) ? perms : []).map((p: any) => ({
            permsid: p.permsid, permvalue: Number(p.permvalue) || 0,
            permnegated: Number(p.permnegated) || 0, permskip: Number(p.permskip) || 0,
          })),
        };
      }));
      const payload = { format: 'ts6manager-group-export', version: 1, groupType: 'server', exportedAt: new Date().toISOString(), groups: exported };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `server-groups-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('pages.serverGroups.exportedCount', { count: exported.length }));
    } catch {
      toast.error(t('pages.serverGroups.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    if (!selectedConfigId || !selectedSid) return;
    setImporting(true);
    try {
      let payload: any;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        toast.error(t('pages.serverGroups.invalidJson'));
        return;
      }
      if (payload.format !== 'ts6manager-group-export' || !Array.isArray(payload.groups)) {
        toast.error(t('pages.serverGroups.notValidGroupExport'));
        return;
      }
      if (payload.groupType !== 'server') {
        toast.error(payload.groupType === 'channel'
          ? t('pages.serverGroups.wrongExportTypeChannel')
          : t('pages.serverGroups.notValidServerExport'));
        return;
      }
      if (payload.groups.length === 0) {
        toast.error(t('pages.serverGroups.emptyExportFile'));
        return;
      }

      let imported = 0;
      let permCount = 0;
      let permFailed = 0;
      const skipped: string[] = [];
      for (const g of payload.groups) {
        let sgid: number;
        try {
          const created = await createGroup.mutateAsync(g.name);
          sgid = Number(created?.[0]?.sgid ?? created?.sgid);
        } catch (err) {
          skipped.push(`"${g.name}" (${tsErrorMessage(err, t('pages.serverGroups.createFailedFallback'), t)})`);
          continue;
        }
        imported++;
        for (const p of g.permissions || []) {
          try {
            await permissionsApi.addServerGroupPerm(selectedConfigId, selectedSid, sgid, p);
            permCount++;
          } catch {
            permFailed++;
          }
        }
      }

      if (imported === 0) {
        toast.error(t('pages.serverGroups.importFailed', { reason: skipped[0] || t('pages.serverGroups.importFailedNoGroups') }));
        return;
      }
      let msg = t('pages.serverGroups.importSummary', { imported, total: payload.groups.length, permCount });
      if (permFailed > 0) msg += t('pages.serverGroups.importPermSkipped', { count: permFailed });
      if (skipped.length > 0) msg += t('pages.serverGroups.importSkippedList', { list: skipped.join(', ') });
      if (skipped.length > 0 || permFailed > 0) toast.warning(msg);
      else toast.success(msg);
    } finally {
      setImporting(false);
    }
  };

  const memberCldbids = useMemo(
    () => new Set((Array.isArray(members) ? members : []).map((m: any) => String(m.cldbid))),
    [members],
  );

  const filteredDbClients = useMemo(() => {
    const list = Array.isArray(dbClients) ? dbClients : [];
    const q = memberSearch.trim().toLowerCase();
    return list
      .filter((c: any) => !memberCldbids.has(String(c.cldbid)))
      .filter((c: any) => !q || String(c.client_nickname || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [dbClients, memberSearch, memberCldbids]);

  if (!selectedConfigId || !selectedSid) return <EmptyState icon={Shield} title={t('pages.noServerSelected')} />;
  if (isLoading) return <PageLoader />;

  const groups = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('nav.items.serverGroups')}</h1>
        <div className="flex items-center gap-2">
          {checkedIds.size > 0 && (
            <>
              <Badge variant="secondary" className="font-mono-data">{t('pages.serverGroups.selectedCount', { count: checkedIds.size })}</Badge>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                <Download className="h-3.5 w-3.5 mr-1" /> {t('pages.serverGroups.exportSelected')}
              </Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowBulkDelete(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> {t('pages.serverGroups.deleteSelected')}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            <Upload className="h-3.5 w-3.5 mr-1" /> {t('pages.serverGroups.import')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
          />
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t('pages.serverGroups.createGroup')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Group List */}
        <Card className="card-hero lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('pages.serverGroups.groupsHeading', { count: groups.length })}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
              <div className="p-2 space-y-0.5">
                {groups.map((g: any) => (
                  <div
                    key={g.sgid}
                    onClick={() => setSelectedGroup(g.sgid)}
                    className={cn(
                      'flex items-center justify-between w-full rounded-md px-3 py-2 text-sm transition-colors text-left cursor-pointer',
                      selectedGroup === g.sgid ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Checkbox
                        checked={checkedIds.has(g.sgid)}
                        onCheckedChange={() => toggleChecked(g.sgid)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={t('pages.serverGroups.selectForBulkDelete')}
                      />
                      <Shield className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{g.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <IconImage iconId={normalizeIconId(g.iconid)} size={16} alt={t('pages.serverGroups.iconAlt', { name: g.name })} />
                      <Badge variant="secondary" className="text-[10px] font-mono-data">{g.sgid}</Badge>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Members */}
        <Card className="card-hero lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                {t('pages.serverGroups.members')}
                {selectedGroup && <Badge variant="default" className="font-mono-data text-[10px]">{t('pages.serverGroups.sgidLabel', { id: selectedGroup })}</Badge>}
              </CardTitle>
              {selectedGroup && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setMemberSearch(''); setShowAddMember(true); }}>
                    <UserPlus className="h-3 w-3 mr-1" /> {t('pages.serverGroups.addMember')}
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => {
                    const g = groups.find((g: any) => g.sgid === selectedGroup);
                    if (g) setDeleteTarget({ sgid: g.sgid, name: g.name });
                  }}>
                    <Trash2 className="h-3 w-3 mr-1" /> {t('pages.serverGroups.deleteGroup')}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedGroup ? (
              <p className="text-sm text-muted-foreground text-center py-12">{t('pages.serverGroups.selectGroupHint')}</p>
            ) : (
              <ScrollArea className="h-[440px]">
                <div className="space-y-1">
                  {Array.isArray(members) && members.length > 0 ? (
                    members.map((m: any, i: number) => (
                      <div key={i} className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/30 transition-colors group">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-mono-data text-primary">
                            {m.client_nickname?.[0]?.toUpperCase() || '?'}
                          </div>
                          <span className="text-sm">{m.client_nickname || t('pages.serverGroups.dbidLabel', { id: m.cldbid })}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-mono-data">{t('pages.serverGroups.dbidLabel', { id: m.cldbid })}</span>
                          <button
                            className="p-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            title={t('pages.serverGroups.removeFromGroup')}
                            onClick={() => {
                              if (!selectedGroup) return;
                              removeMember.mutate({ sgid: selectedGroup, cldbid: Number(m.cldbid) }, {
                                onSuccess: () => toast.success(t('pages.serverGroups.memberRemoved')),
                                onError: () => toast.error(t('pages.serverGroups.memberRemoveFailed')),
                              });
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">{t('pages.serverGroups.noMembers')}</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.serverGroups.addMember')}</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder={t('pages.serverGroups.searchClientsPlaceholder')}
              className="pl-8 h-9"
              autoFocus
            />
          </div>
          <ScrollArea className="h-[320px]">
            <div className="space-y-0.5 pr-2">
              {filteredDbClients.length > 0 ? (
                filteredDbClients.map((c: any) => (
                  <div key={c.cldbid} className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-mono-data text-primary shrink-0">
                        {c.client_nickname?.[0]?.toUpperCase() || '?'}
                      </div>
                      <span className="text-sm truncate">{c.client_nickname || t('pages.serverGroups.dbidLabel', { id: c.cldbid })}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      disabled={addMember.isPending}
                      onClick={() => {
                        if (!selectedGroup) return;
                        addMember.mutate({ sgid: selectedGroup, cldbid: Number(c.cldbid) }, {
                          onSuccess: () => toast.success(t('pages.serverGroups.added', { name: c.client_nickname || t('pages.serverGroups.genericClient') })),
                          onError: () => toast.error(t('pages.serverGroups.addMemberFailed')),
                        });
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" /> {t('common.add')}
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">{t('pages.serverGroups.noMatchingClients')}</p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddMember(false)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.serverGroups.createServerGroupTitle')}</DialogTitle></DialogHeader>
          <div><Label className="text-xs">{t('pages.serverGroups.groupNameLabel')}</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('pages.serverGroups.newGroupPlaceholder')} autoFocus /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => { createGroup.mutate(newName, { onSuccess: () => { toast.success(t('pages.serverGroups.groupCreated')); setShowCreate(false); setNewName(''); } }); }}>{t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} title={t('pages.serverGroups.deleteServerGroupTitle')} description={t('pages.serverGroups.deleteGroupDescription', { name: deleteTarget?.name })} confirmLabel={t('common.delete')} destructive onConfirm={() => { if (deleteTarget) deleteGroup.mutate(deleteTarget.sgid, { onSuccess: () => { toast.success(t('pages.serverGroups.groupDeleted')); setDeleteTarget(null); setSelectedGroup(null); } }); }} />

      <ConfirmDialog
        open={showBulkDelete}
        onOpenChange={setShowBulkDelete}
        title={t('pages.serverGroups.deleteServerGroupsTitle')}
        description={t('pages.serverGroups.bulkDeleteDescription', { count: checkedIds.size })}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={handleBulkDelete}
        loading={bulkDeleting}
      />
    </div>
  );
}
