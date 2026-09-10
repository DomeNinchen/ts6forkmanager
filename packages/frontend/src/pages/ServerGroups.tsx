import { useMemo, useState } from 'react';
import {
  useServerGroups, useServerGroupMembers, useCreateServerGroup, useDeleteServerGroup,
  useAddServerGroupMember, useRemoveServerGroupMember,
} from '@/hooks/use-groups';
import { useClientDatabase } from '@/hooks/use-clients';
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
import { cn } from '@/lib/utils';
import { Shield, Plus, Trash2, Users, ChevronRight, UserPlus, X, Search } from 'lucide-react';
import { toast } from 'sonner';

export default function ServerGroups() {
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

  if (!selectedConfigId || !selectedSid) return <EmptyState icon={Shield} title="No server selected" />;
  if (isLoading) return <PageLoader />;

  const groups = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Server Groups</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> Create Group
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Group List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Groups ({groups.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
              <div className="p-2 space-y-0.5">
                {groups.map((g: any) => (
                  <button
                    key={g.sgid}
                    onClick={() => setSelectedGroup(g.sgid)}
                    className={cn(
                      'flex items-center justify-between w-full rounded-md px-3 py-2 text-sm transition-colors text-left',
                      selectedGroup === g.sgid ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5" />
                      <span className="truncate">{g.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px] font-mono-data">{g.sgid}</Badge>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Members */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Members
                {selectedGroup && <Badge variant="default" className="font-mono-data text-[10px]">SGID: {selectedGroup}</Badge>}
              </CardTitle>
              {selectedGroup && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setMemberSearch(''); setShowAddMember(true); }}>
                    <UserPlus className="h-3 w-3 mr-1" /> Add Member
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => {
                    const g = groups.find((g: any) => g.sgid === selectedGroup);
                    if (g) setDeleteTarget({ sgid: g.sgid, name: g.name });
                  }}>
                    <Trash2 className="h-3 w-3 mr-1" /> Delete Group
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedGroup ? (
              <p className="text-sm text-muted-foreground text-center py-12">Select a group to view its members</p>
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
                          <span className="text-sm">{m.client_nickname || `DBID: ${m.cldbid}`}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-mono-data">DBID: {m.cldbid}</span>
                          <button
                            className="p-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            title="Remove from group"
                            onClick={() => {
                              if (!selectedGroup) return;
                              removeMember.mutate({ sgid: selectedGroup, cldbid: Number(m.cldbid) }, {
                                onSuccess: () => toast.success('Member removed'),
                                onError: () => toast.error('Failed to remove member'),
                              });
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No members in this group</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Member</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search clients..."
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
                      <span className="text-sm truncate">{c.client_nickname || `DBID: ${c.cldbid}`}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      disabled={addMember.isPending}
                      onClick={() => {
                        if (!selectedGroup) return;
                        addMember.mutate({ sgid: selectedGroup, cldbid: Number(c.cldbid) }, {
                          onSuccess: () => toast.success(`Added ${c.client_nickname || 'client'}`),
                          onError: () => toast.error('Failed to add member'),
                        });
                      }}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No matching clients</p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddMember(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Server Group</DialogTitle></DialogHeader>
          <div><Label className="text-xs">Group Name</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New Group" autoFocus /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => { createGroup.mutate(newName, { onSuccess: () => { toast.success('Group created'); setShowCreate(false); setNewName(''); } }); }}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} title="Delete Server Group" description={`Delete "${deleteTarget?.name}"?`} confirmLabel="Delete" destructive onConfirm={() => { if (deleteTarget) deleteGroup.mutate(deleteTarget.sgid, { onSuccess: () => { toast.success('Group deleted'); setDeleteTarget(null); setSelectedGroup(null); } }); }} />
    </div>
  );
}
