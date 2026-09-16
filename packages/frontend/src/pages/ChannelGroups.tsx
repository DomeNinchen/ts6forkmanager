import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { ShieldCheck, Search, User, Plus, Trash2, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

export default function ChannelGroups() {
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
    if (failed > 0) toast.error(`Deleted ${results.length - failed}, failed ${failed}`);
    else toast.success(`${results.length} group(s) deleted`);
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
      toast.success(`Exported ${exported.length} group(s)`);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (file: File) => {
    if (!c || !s) return;
    setImporting(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (payload.format !== 'ts6manager-group-export' || payload.groupType !== 'channel' || !Array.isArray(payload.groups)) {
        toast.error('Not a valid channel group export file');
        return;
      }
      let permCount = 0;
      for (const g of payload.groups) {
        const created = await createGroup.mutateAsync(g.name);
        const cgid = Number(created?.[0]?.cgid ?? created?.cgid);
        for (const p of g.permissions || []) {
          await permissionsApi.addChannelGroupPerm(c, s, cgid, p);
          permCount++;
        }
      }
      toast.success(`Imported ${payload.groups.length} group(s), ${permCount} permission(s)`);
    } catch {
      toast.error('Import failed - check the file is a valid export');
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
      toast.success('Channel group updated');
      qc.invalidateQueries({ queryKey: ['channel-groups-by-client'] });
    },
    onError: () => toast.error('Failed to update channel group'),
  });

  const clientCandidates = useMemo(() => {
    const online = (Array.isArray(onlineClients) ? onlineClients : [])
      .filter((cl: any) => String(cl.client_type) === '0')
      .map((cl: any) => ({ cldbid: Number(cl.client_database_id), name: cl.client_nickname, online: true }));
    if (!showOffline) return online;
    const onlineIds = new Set(online.map((o) => o.cldbid));
    const offline = (Array.isArray(offlineClients) ? offlineClients : [])
      .filter((cl: any) => !onlineIds.has(Number(cl.cldbid)))
      .map((cl: any) => ({ cldbid: Number(cl.cldbid), name: cl.client_nickname || `Client #${cl.cldbid}`, online: false }));
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

  if (!c || !s) return <EmptyState icon={ShieldCheck} title="No server selected" />;
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Channel Groups</h1>
        {tab === 'groups' && (
          <div className="flex items-center gap-2">
            {checkedIds.size > 0 && (
              <>
                <Badge variant="secondary" className="font-mono-data">{checkedIds.size} selected</Badge>
                <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export Selected
                </Button>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setShowBulkDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete Selected
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }}
            />
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" /> Create Group
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-1 p-1 bg-muted/30 rounded-lg w-fit">
        <button
          onClick={() => setTab('groups')}
          className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', tab === 'groups' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
        >
          Groups
        </button>
        <button
          onClick={() => setTab('by-client')}
          className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', tab === 'by-client' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}
        >
          By Client
        </button>
      </div>

      {tab === 'groups' ? (
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Groups ({groups.length})</CardTitle>
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
                        aria-label="Select for bulk delete"
                      />
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{g.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] font-mono-data">CGID: {g.cgid}</Badge>
                      <Badge variant="outline" className="text-[10px] font-mono-data">Type: {g.type}</Badge>
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
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Select Client</CardTitle>
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Search clients..." className="h-7 pl-7 text-xs" />
              </div>
              <div className="flex items-center gap-1.5">
                <Switch id="cg-show-offline" checked={showOffline} onCheckedChange={setShowOffline} />
                <Label htmlFor="cg-show-offline" className="text-xs text-muted-foreground cursor-pointer">Show offline clients</Label>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[440px]">
                <div className="p-2 space-y-0.5">
                  {clientCandidates.map((cl) => (
                    <button
                      key={cl.cldbid}
                      onClick={() => setSelectedClient({ cldbid: cl.cldbid, name: cl.name })}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2',
                        selectedClient?.cldbid === cl.cldbid ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50',
                      )}
                    >
                      {showOffline && (
                        <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', cl.online ? 'bg-emerald-500' : 'bg-zinc-500')} title={cl.online ? 'Online' : 'Offline'} />
                      )}
                      <span className="truncate">{cl.name}</span>
                    </button>
                  ))}
                  {clientCandidates.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No clients found</p>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="card-hero col-span-8">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {selectedClient ? `${selectedClient.name}'s Channel Groups` : 'Select a client'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!selectedClient ? (
                <div className="flex items-center justify-center h-[400px]">
                  <p className="text-sm text-muted-foreground">Select a client from the left panel</p>
                </div>
              ) : loadingClientGroups ? (
                <div className="flex items-center justify-center h-[400px]"><PageLoader /></div>
              ) : assignments.length === 0 ? (
                <div className="flex items-center justify-center h-[400px]">
                  <EmptyState icon={User} title="No channel group assignments" description="This client has no non-default channel group in any channel." />
                </div>
              ) : (
                <div className="px-3 pb-3">
                  <div className="grid grid-cols-12 gap-2 px-2 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
                    <div className="col-span-6">Channel</div>
                    <div className="col-span-6">Channel Group</div>
                  </div>
                  {assignments.map((a: any) => {
                    const cid = Number(a.cid);
                    const currentCgid = String(Number(a.cgid));
                    return (
                      <div key={cid} className="grid grid-cols-12 gap-2 px-2 py-1.5 rounded-sm text-sm items-center hover:bg-muted/20">
                        <div className="col-span-6 truncate">{channels.find((ch) => ch.cid === cid)?.name || `#${cid}`}</div>
                        <div className="col-span-6">
                          <Select
                            value={currentCgid}
                            onValueChange={(v) => assignMutation.mutate({ cgid: Number(v), cid })}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {groups.map((g: any) => (
                                <SelectItem key={g.cgid} value={String(g.cgid)}>{g.name}</SelectItem>
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
          <DialogHeader><DialogTitle>Create Channel Group</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">Group Name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New Group" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createGroup.mutate(newName, { onSuccess: () => { toast.success('Group created'); setShowCreate(false); setNewName(''); } })}
              disabled={!newName.trim() || createGroup.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showBulkDelete}
        onOpenChange={setShowBulkDelete}
        title="Delete Channel Groups"
        description={`Delete ${checkedIds.size} selected group(s)? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleBulkDelete}
        loading={bulkDeleting}
      />
    </div>
  );
}
