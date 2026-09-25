import { useMemo, useState } from 'react';
import { useChannels, useCreateChannel, useDeleteChannel, useEditChannel, useMoveChannel } from '@/hooks/use-channels';
import { useClients } from '@/hooks/use-clients';
import { channelsApi } from '@/api/channels.api';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EditChannelDialog } from '@/components/channels/EditChannelDialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Hash, Plus, Trash2, Pencil, ChevronRight, ChevronDown, Users, Lock, Volume2, Terminal, Copy, X, ListChecks } from 'lucide-react';
import { toast } from 'sonner';

interface ChannelNode {
  cid: number;
  pid: number;
  channel_name: string;
  channel_topic: string;
  total_clients: number;
  channel_flag_permanent: number;
  channel_flag_password: number;
  channel_codec_quality: number;
  children: ChannelNode[];
}

interface ClientInfo {
  clid: number;
  cid: number;
  client_nickname: string;
  client_type: string;
  client_away: number;
  client_input_muted: number;
}

function buildTree(channels: any[]): ChannelNode[] {
  const normalized = channels.map((ch) => ({
    ...ch,
    cid: Number(ch.cid),
    pid: Number(ch.pid),
    total_clients: Number(ch.total_clients) || 0,
    channel_flag_permanent: Number(ch.channel_flag_permanent) || 0,
    channel_flag_password: Number(ch.channel_flag_password) || 0,
    channel_codec_quality: Number(ch.channel_codec_quality) || 0,
    channel_topic: ch.channel_topic || '',
  }));
  const map = new Map<number, ChannelNode>();
  const roots: ChannelNode[] = [];
  normalized.forEach((ch) => map.set(ch.cid, { ...ch, children: [] }));
  normalized.forEach((ch) => {
    const node = map.get(ch.cid)!;
    if (ch.pid === 0) roots.push(node);
    else map.get(ch.pid)?.children.push(node);
  });
  return roots;
}

function ClientEntry({ client, depth }: { client: ClientInfo; depth: number }) {
  const isQuery = client.client_type === '1';
  return (
    <div
      className="flex items-center gap-1.5 py-0.5 px-2 text-xs text-muted-foreground"
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
    >
      {isQuery ? (
        <div className="h-4 w-4 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Terminal className="h-2.5 w-2.5 text-muted-foreground" />
        </div>
      ) : (
        <div className="h-4 w-4 rounded-full bg-primary/10 flex items-center justify-center text-[8px] font-mono-data text-primary shrink-0">
          {client.client_nickname?.[0]?.toUpperCase() || '?'}
        </div>
      )}
      <span className="truncate">{client.client_nickname}</span>
      {isQuery && <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">Query</Badge>}
      {client.client_away === 1 && <Badge variant="warning" className="text-[8px] px-1 py-0 h-3.5">Away</Badge>}
      {client.client_input_muted === 1 && !client.client_away && <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5">Muted</Badge>}
    </div>
  );
}

interface TreeNodeProps {
  node: ChannelNode;
  depth?: number;
  isAdmin: boolean;
  clientsByChannel: Map<number, ClientInfo[]>;
  onDelete: (cid: number, name: string) => void;
  onEdit: (node: ChannelNode) => void;
  onDuplicate: (node: ChannelNode) => void;
  onDrop: (draggedCid: number, targetCid: number) => void;
  draggedCid: number | null;
  setDraggedCid: (cid: number | null) => void;
  selected: Set<number>;
  onToggleSelect: (cid: number) => void;
}

function ChannelTreeNode({ node, depth = 0, isAdmin, clientsByChannel, onDelete, onEdit, onDuplicate, onDrop, draggedCid, setDraggedCid, selected, onToggleSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [dropOver, setDropOver] = useState(false);
  const hasChildren = node.children.length > 0;
  const clients = clientsByChannel.get(node.cid) || [];
  const hasContent = hasChildren || clients.length > 0;
  const isSpacer = node.channel_name.startsWith('[spacer') || node.channel_name.startsWith('[*spacer');

  if (isSpacer) {
    return (
      <div className="py-0.5" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        <div className="border-t border-border/40 my-1" />
      </div>
    );
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', String(node.cid));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedCid(node.cid);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedCid && draggedCid !== node.cid) {
      setDropOver(true);
    }
  };

  const handleDragLeave = () => setDropOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropOver(false);
    const cidStr = e.dataTransfer.getData('text/plain');
    const cid = Number(cidStr);
    if (cid && cid !== node.cid) {
      onDrop(cid, node.cid);
    }
  };

  const handleDragEnd = () => setDraggedCid(null);

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-1 px-2 rounded-xs hover:bg-muted/30 transition-colors group text-sm',
          isAdmin && 'cursor-grab active:cursor-grabbing',
          dropOver && 'bg-primary/10 ring-1 ring-primary/40',
          draggedCid === node.cid && 'opacity-40',
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        draggable={isAdmin}
        onDragStart={isAdmin ? handleDragStart : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      >
        {isAdmin && (
          <Checkbox
            checked={selected.has(node.cid)}
            onCheckedChange={() => onToggleSelect(node.cid)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select channel"
          />
        )}

        {hasContent ? (
          <button onClick={() => setExpanded(!expanded)} className="p-0.5 hover:bg-muted rounded-xs">
            {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <Hash className="h-3.5 w-3.5 text-primary/70 shrink-0" />

        <span className="truncate flex-1">{node.channel_name}</span>

        <span className="text-[10px] font-mono-data text-muted-foreground/50 shrink-0">#{node.cid}</span>

        {isAdmin && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onDuplicate(node)}
              title="Use as template"
              className="p-1 rounded-xs hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              onClick={() => onEdit(node)}
              className="p-1 rounded-xs hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => onDelete(node.cid, node.channel_name)}
              className="p-1 rounded-xs hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5 ml-1">
          {node.channel_flag_password === 1 && <Lock className="h-3 w-3 text-amber-400/60" />}
          {(node.total_clients > 0 || clients.length > 0) && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground font-mono-data">
              <Users className="h-3 w-3" />
              {clients.length || node.total_clients}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <>
          {clients.map((client) => (
            <ClientEntry key={client.clid} client={client} depth={depth + 1} />
          ))}
          {node.children.map((child) => (
            <ChannelTreeNode
              key={child.cid}
              node={child}
              depth={depth + 1}
              isAdmin={isAdmin}
              clientsByChannel={clientsByChannel}
              onDelete={onDelete}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onDrop={onDrop}
              draggedCid={draggedCid}
              setDraggedCid={setDraggedCid}
              selected={selected}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </>
      )}
    </div>
  );
}

export default function Channels() {
  const { selectedConfigId, selectedSid } = useServerStore();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data: channelData, isLoading: channelsLoading } = useChannels();
  const { data: clientData } = useClients();
  const createChannel = useCreateChannel();
  const deleteChannel = useDeleteChannel();
  const editChannel = useEditChannel();
  const moveChannel = useMoveChannel();

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ cid: number; name: string } | null>(null);
  const [editTarget, setEditTarget] = useState<ChannelNode | null>(null);
  const [newNames, setNewNames] = useState('');
  const [draggedCid, setDraggedCid] = useState<number | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleSelect = (cid: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(cid) ? next.delete(cid) : next.add(cid);
    return next;
  });

  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkEdit, setBulkEdit] = useState({
    codec: { apply: false, value: '4' },
    codecQuality: { apply: false, value: '7' },
    talkPower: { apply: false, value: '0' },
    permanent: { apply: false, value: true },
  });
  const [bulkEditPending, setBulkEditPending] = useState(false);

  const [duplicateSource, setDuplicateSource] = useState<ChannelNode | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicatePending, setDuplicatePending] = useState(false);

  const tree = useMemo(() => {
    if (!channelData || !Array.isArray(channelData)) return [];
    return buildTree(channelData);
  }, [channelData]);

  const clientsByChannel = useMemo(() => {
    const map = new Map<number, ClientInfo[]>();
    if (!clientData || !Array.isArray(clientData)) return map;
    for (const c of clientData) {
      const cid = Number(c.cid);
      const entry: ClientInfo = {
        clid: Number(c.clid),
        cid,
        client_nickname: c.client_nickname || '?',
        client_type: String(c.client_type),
        client_away: Number(c.client_away) || 0,
        client_input_muted: Number(c.client_input_muted) || 0,
      };
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid)!.push(entry);
    }
    return map;
  }, [clientData]);

  if (!selectedConfigId || !selectedSid) return <EmptyState icon={Hash} title="No server selected" />;
  if (channelsLoading) return <PageLoader />;

  const handleCreate = async () => {
    const names = newNames.split('\n').map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) return;
    const results = await Promise.allSettled(
      names.map((channel_name) => createChannel.mutateAsync({ channel_name, channel_flag_permanent: 1 })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 0) {
      toast.success(names.length === 1 ? 'Channel created' : `${names.length} channels created`);
    } else {
      toast.error(`${names.length - failed}/${names.length} created, ${failed} failed`);
    }
    setShowCreate(false);
    setNewNames('');
  };

  const handleBulkEditSave = async () => {
    const data: any = {};
    if (bulkEdit.codec.apply) data.channel_codec = Number(bulkEdit.codec.value);
    if (bulkEdit.codecQuality.apply) data.channel_codec_quality = Number(bulkEdit.codecQuality.value);
    if (bulkEdit.talkPower.apply) data.channel_needed_talk_power = Number(bulkEdit.talkPower.value);
    if (bulkEdit.permanent.apply) data.channel_flag_permanent = bulkEdit.permanent.value ? 1 : 0;
    if (Object.keys(data).length === 0) { setShowBulkEdit(false); return; }

    setBulkEditPending(true);
    const results = await Promise.allSettled(
      Array.from(selected).map((cid) => editChannel.mutateAsync({ cid, data })),
    );
    setBulkEditPending(false);
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 0) toast.success(`Updated ${selected.size} channel(s)`);
    else toast.error(`${selected.size - failed}/${selected.size} updated, ${failed} failed`);
    setShowBulkEdit(false);
    setSelected(new Set());
  };

  const handleDuplicate = async () => {
    if (!duplicateSource || !duplicateName.trim() || !selectedConfigId || !selectedSid) return;
    setDuplicatePending(true);
    try {
      const info = await channelsApi.get(selectedConfigId, selectedSid, duplicateSource.cid);
      const source = Array.isArray(info) ? info[0] : info;
      const data: any = {
        channel_name: duplicateName.trim(),
        channel_topic: source?.channel_topic,
        channel_description: source?.channel_description,
        channel_codec: source?.channel_codec,
        channel_codec_quality: source?.channel_codec_quality,
        channel_maxclients: source?.channel_maxclients,
        channel_maxfamilyclients: source?.channel_maxfamilyclients,
        channel_flag_permanent: source?.channel_flag_permanent,
        channel_flag_semi_permanent: source?.channel_flag_semi_permanent,
        channel_needed_talk_power: source?.channel_needed_talk_power,
        cpid: source?.pid,
      };
      await createChannel.mutateAsync(data);
      toast.success(`Created "${duplicateName.trim()}" from "${duplicateSource.channel_name}"`);
      setDuplicateSource(null);
      setDuplicateName('');
    } catch (err: any) {
      toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to duplicate channel');
    } finally {
      setDuplicatePending(false);
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteChannel.mutate(deleteTarget.cid, {
      onSuccess: () => { toast.success('Channel deleted'); setDeleteTarget(null); },
      onError: () => toast.error('Failed to delete channel'),
    });
  };

  const handleEditOpen = (node: ChannelNode) => setEditTarget(node);

  const handleDrop = (draggedCid: number, targetCid: number) => {
    moveChannel.mutate({ cid: draggedCid, data: { cpid: targetCid } }, {
      onSuccess: () => toast.success('Channel moved'),
      onError: () => toast.error('Failed to move channel'),
    });
  };

  const totalClients = clientsByChannel.size > 0
    ? Array.from(clientsByChannel.values()).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Channels</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {Array.isArray(channelData) ? channelData.length : 0} channels · {totalClients} clients online
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create Channel
          </Button>
        )}
      </div>

      {isAdmin && selected.size > 0 && (
        <div className="card-hero flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setShowBulkEdit(true)}>
            <ListChecks className="h-3.5 w-3.5 mr-1.5" /> Edit Selected
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5 mr-1.5" /> Clear
          </Button>
        </div>
      )}

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-primary" />
            Channel Tree
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            <div className="space-y-0">
              {tree.map((node) => (
                <ChannelTreeNode
                  key={node.cid}
                  node={node}
                  isAdmin={isAdmin}
                  clientsByChannel={clientsByChannel}
                  onDelete={(cid, name) => setDeleteTarget({ cid, name })}
                  onEdit={handleEditOpen}
                  onDuplicate={(node) => { setDuplicateSource(node); setDuplicateName(''); }}
                  onDrop={handleDrop}
                  draggedCid={draggedCid}
                  setDraggedCid={setDraggedCid}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Channel Name(s)</Label>
              <Textarea
                value={newNames}
                onChange={(e) => setNewNames(e.target.value)}
                placeholder={'New Channel\nOne name per line to create multiple at once'}
                rows={3}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newNames.trim() || createChannel.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Edit Dialog */}
      <Dialog open={showBulkEdit} onOpenChange={(v) => !v && setShowBulkEdit(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {selected.size} channel(s)</DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-muted-foreground">Only checked fields are applied - the rest are left untouched on each selected channel.</p>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox checked={bulkEdit.codec.apply} onCheckedChange={(v) => setBulkEdit({ ...bulkEdit, codec: { ...bulkEdit.codec, apply: !!v } })} />
              <Label className="text-xs w-28">Codec</Label>
              <Select value={bulkEdit.codec.value} onValueChange={(v) => setBulkEdit({ ...bulkEdit, codec: { ...bulkEdit.codec, value: v } })} disabled={!bulkEdit.codec.apply}>
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">Opus Voice</SelectItem>
                  <SelectItem value="5">Opus Music</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={bulkEdit.codecQuality.apply} onCheckedChange={(v) => setBulkEdit({ ...bulkEdit, codecQuality: { ...bulkEdit.codecQuality, apply: !!v } })} />
              <Label className="text-xs w-28">Codec Quality</Label>
              <Input type="number" min={0} max={10} className="h-8 text-xs flex-1" disabled={!bulkEdit.codecQuality.apply}
                value={bulkEdit.codecQuality.value} onChange={(e) => setBulkEdit({ ...bulkEdit, codecQuality: { ...bulkEdit.codecQuality, value: e.target.value } })} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={bulkEdit.talkPower.apply} onCheckedChange={(v) => setBulkEdit({ ...bulkEdit, talkPower: { ...bulkEdit.talkPower, apply: !!v } })} />
              <Label className="text-xs w-28">Needed Talk Power</Label>
              <Input type="number" min={0} className="h-8 text-xs flex-1" disabled={!bulkEdit.talkPower.apply}
                value={bulkEdit.talkPower.value} onChange={(e) => setBulkEdit({ ...bulkEdit, talkPower: { ...bulkEdit.talkPower, value: e.target.value } })} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={bulkEdit.permanent.apply} onCheckedChange={(v) => setBulkEdit({ ...bulkEdit, permanent: { ...bulkEdit.permanent, apply: !!v } })} />
              <Label className="text-xs w-28">Permanent</Label>
              <Switch checked={bulkEdit.permanent.value} onCheckedChange={(v) => setBulkEdit({ ...bulkEdit, permanent: { ...bulkEdit.permanent, value: v } })} disabled={!bulkEdit.permanent.apply} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkEdit(false)}>Cancel</Button>
            <Button
              onClick={handleBulkEditSave}
              disabled={bulkEditPending || !(bulkEdit.codec.apply || bulkEdit.codecQuality.apply || bulkEdit.talkPower.apply || bulkEdit.permanent.apply)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate (use as template) Dialog */}
      <Dialog open={!!duplicateSource} onOpenChange={(v) => !v && setDuplicateSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate "{duplicateSource?.channel_name}"</DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-muted-foreground">Creates a new channel with the same settings (topic, codec, limits, talk power) as this one.</p>
          <div>
            <Label className="text-xs">New Channel Name</Label>
            <Input value={duplicateName} onChange={(e) => setDuplicateName(e.target.value)} placeholder={`${duplicateSource?.channel_name || ''} Copy`} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateSource(null)}>Cancel</Button>
            <Button onClick={handleDuplicate} disabled={!duplicateName.trim() || duplicatePending}>
              <Copy className="h-4 w-4 mr-1" /> Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <EditChannelDialog
        cid={editTarget?.cid ?? null}
        fallbackName={editTarget?.channel_name ?? ''}
        onClose={() => setEditTarget(null)}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title="Delete Channel"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        loading={deleteChannel.isPending}
      />
    </div>
  );
}
