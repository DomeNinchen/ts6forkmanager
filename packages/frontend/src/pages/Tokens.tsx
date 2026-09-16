import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tokensApi, tempPasswordsApi } from '@/api/bans.api';
import { channelsApi } from '@/api/channels.api';
import { groupsApi } from '@/api/groups.api';
import { useServerStore } from '@/stores/server.store';
import { DataTable, type DataTableFeatures } from '@/components/shared/DataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDuration, cn } from '@/lib/utils';
import { KeyRound, Trash2, Copy, Clock, Plus, Dices } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

const DURATION_UNITS = [
  { key: 'minutes', label: 'Minutes', seconds: 60 },
  { key: 'hours', label: 'Hours', seconds: 3600 },
  { key: 'days', label: 'Days', seconds: 86400 },
];

function randomPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function Tokens() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['tokens', c, s], queryFn: () => tokensApi.list(c!, s!), enabled: !!c && !!s });
  const deleteToken = useMutation({ mutationFn: (token: string) => tokensApi.delete(c!, s!, token), onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }) });

  const { data: tempData, isLoading: loadingTemp } = useQuery({
    queryKey: ['temp-passwords', c, s],
    queryFn: () => tempPasswordsApi.list(c!, s!),
    enabled: !!c && !!s,
  });
  const { data: channelData } = useQuery({
    queryKey: ['channels-for-tokens', c, s],
    queryFn: () => channelsApi.list(c!, s!),
    enabled: !!c && !!s,
  });

  const [showCreateToken, setShowCreateToken] = useState(false);
  const [tokenType, setTokenType] = useState('0');
  const [tokenGroupId, setTokenGroupId] = useState('');
  const [tokenChannelId, setTokenChannelId] = useState('');
  const [tokenDesc, setTokenDesc] = useState('');

  const { data: serverGroupData } = useQuery({
    queryKey: ['server-groups', c, s],
    queryFn: () => groupsApi.serverGroups(c!, s!),
    enabled: !!c && !!s && showCreateToken,
  });
  const { data: channelGroupData } = useQuery({
    queryKey: ['channel-groups', c, s],
    queryFn: () => groupsApi.channelGroups(c!, s!),
    enabled: !!c && !!s && showCreateToken,
  });

  const createToken = useMutation({
    mutationFn: () => tokensApi.add(c!, s!, {
      tokentype: Number(tokenType),
      tokenid1: Number(tokenGroupId),
      tokenid2: tokenType === '1' ? Number(tokenChannelId) : 0,
      tokendescription: tokenDesc,
    }),
    onSuccess: (res: any) => {
      const token = Array.isArray(res) ? res[0]?.token : res?.token;
      if (token) navigator.clipboard.writeText(token);
      toast.success(token ? 'Token created and copied to clipboard' : 'Token created');
      qc.invalidateQueries({ queryKey: ['tokens'] });
      setShowCreateToken(false);
      setTokenGroupId(''); setTokenChannelId(''); setTokenDesc('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to create token'),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [pw, setPw] = useState('');
  const [desc, setDesc] = useState('');
  const [durationValue, setDurationValue] = useState('1');
  const [durationUnit, setDurationUnit] = useState('hours');
  const [targetCid, setTargetCid] = useState('0');

  const createTemp = useMutation({
    mutationFn: () => {
      const unit = DURATION_UNITS.find((u) => u.key === durationUnit)!;
      return tempPasswordsApi.add(c!, s!, {
        pw, desc, duration: Number(durationValue) * unit.seconds, tcid: Number(targetCid),
      });
    },
    onSuccess: () => {
      toast.success('Temporary password created');
      qc.invalidateQueries({ queryKey: ['temp-passwords'] });
      setShowCreate(false);
      setPw(''); setDesc(''); setDurationValue('1'); setDurationUnit('hours'); setTargetCid('0');
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to create temporary password'),
  });
  const deleteTemp = useMutation({
    mutationFn: (password: string) => tempPasswordsApi.delete(c!, s!, password),
    onSuccess: () => { toast.success('Temporary password deleted'); qc.invalidateQueries({ queryKey: ['temp-passwords'] }); },
  });

  const tokens = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const tempPasswords = useMemo(() => (Array.isArray(tempData) ? tempData : []), [tempData]);
  const channels = useMemo(() => {
    if (!Array.isArray(channelData)) return [];
    return channelData.map((ch: any) => ({ cid: Number(ch.cid), name: ch.channel_name }));
  }, [channelData]);
  const channelName = (cid: number) => (cid === 0 ? 'Default Channel' : channels.find((ch) => ch.cid === cid)?.name || `#${cid}`);
  // Only regular groups (type 1) can be targeted by a token - confirmed live:
  // template groups (type 0) fail with "invalid group ID", and server query
  // groups (type 2) fail with "invalid parameter". Channel groups have no
  // query type, so this filter is a no-op there beyond excluding templates.
  const serverGroupList = useMemo(() => (Array.isArray(serverGroupData) ? serverGroupData : [])
    .filter((g: any) => Number(g.type) === 1)
    .map((g: any) => ({ id: Number(g.sgid), name: g.name })), [serverGroupData]);
  const channelGroupList = useMemo(() => (Array.isArray(channelGroupData) ? channelGroupData : [])
    .filter((g: any) => Number(g.type) === 1)
    .map((g: any) => ({ id: Number(g.cgid), name: g.name })), [channelGroupData]);

  const columns: ColumnDef<DataTableFeatures, any>[] = useMemo(() => [
    { accessorKey: 'token', header: 'Token', cell: ({ getValue }) => (
      <div className="flex items-center gap-1">
        <span className="font-mono-data text-xs truncate max-w-[200px]">{getValue() as string}</span>
        <button onClick={() => { navigator.clipboard.writeText(getValue() as string); toast.success('Copied'); }} className="p-1 hover:bg-muted rounded-sm"><Copy className="h-3 w-3 text-muted-foreground" /></button>
      </div>
    )},
    { accessorKey: 'token_type', header: 'Type', cell: ({ getValue }) => <span className="text-xs">{(getValue() as number) === 0 ? 'Server Group' : 'Channel Group'}</span> },
    { accessorKey: 'token_id1', header: 'Group ID', cell: ({ getValue }) => <span className="font-mono-data text-xs">{getValue() as number}</span> },
    { accessorKey: 'token_description', header: 'Description', cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '-'}</span> },
    { id: 'actions', header: '', cell: ({ row }) => (
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteToken.mutate(row.original.token, { onSuccess: () => toast.success('Token deleted') })}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    )},
  ], [deleteToken]);

  const tempColumns: ColumnDef<DataTableFeatures, any>[] = useMemo(() => [
    { accessorKey: 'pw_clear', header: 'Password', cell: ({ getValue }) => (
      <div className="flex items-center gap-1">
        <span className="font-mono-data text-xs">{getValue() as string}</span>
        <button onClick={() => { navigator.clipboard.writeText(getValue() as string); toast.success('Copied'); }} className="p-1 hover:bg-muted rounded-sm"><Copy className="h-3 w-3 text-muted-foreground" /></button>
      </div>
    )},
    { accessorKey: 'desc', header: 'Description', cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '-'}</span> },
    { accessorKey: 'tcid', header: 'Target Channel', cell: ({ getValue }) => <span className="text-xs">{channelName(Number(getValue()))}</span> },
    { accessorKey: 'end', header: 'Expires', cell: ({ getValue }) => {
      const remaining = Number(getValue()) - Math.floor(Date.now() / 1000);
      return (
        <span className={cn('text-xs font-mono-data flex items-center gap-1', remaining <= 0 && 'text-destructive')}>
          <Clock className="h-3 w-3" /> {remaining > 0 ? formatDuration(remaining) : 'Expired'}
        </span>
      );
    }},
    { accessorKey: 'nickname', header: 'Created By', cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue() as string}</span> },
    { id: 'actions', header: '', cell: ({ row }) => (
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteTemp.mutate(row.original.pw_clear)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    )},
  ], [deleteTemp, channels]);

  if (!c || !s) return <EmptyState icon={KeyRound} title="No server selected" />;
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Privilege Keys</h1>
        <Button size="sm" onClick={() => setShowCreateToken(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Create Token
        </Button>
      </div>
      <DataTable columns={columns} data={tokens} searchKey="token_description" searchPlaceholder="Search tokens..." />

      <Card className="card-hero">
        <CardHeader className="pb-2 flex items-center justify-between flex-row">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Temporary Passwords</CardTitle>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Create
          </Button>
        </CardHeader>
        <CardContent>
          {loadingTemp ? (
            <PageLoader />
          ) : tempPasswords.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No temporary passwords set</p>
          ) : (
            <DataTable columns={tempColumns} data={tempPasswords} searchKey="desc" searchPlaceholder="Search temporary passwords..." />
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateToken} onOpenChange={setShowCreateToken}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Token</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Group Type</Label>
              <Select value={tokenType} onValueChange={(v) => { setTokenType(v); setTokenGroupId(''); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Server Group</SelectItem>
                  <SelectItem value="1">Channel Group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Group</Label>
              <Select value={tokenGroupId} onValueChange={setTokenGroupId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a group..." /></SelectTrigger>
                <SelectContent>
                  {(tokenType === '0' ? serverGroupList : channelGroupList).map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {tokenType === '1' && (
              <div>
                <Label className="text-xs">Channel</Label>
                <Select value={tokenChannelId} onValueChange={setTokenChannelId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a channel..." /></SelectTrigger>
                  <SelectContent>
                    {channels.map((ch) => (
                      <SelectItem key={ch.cid} value={String(ch.cid)}>{ch.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Description</Label>
              <Input className="mt-1" value={tokenDesc} onChange={(e) => setTokenDesc(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateToken(false)}>Cancel</Button>
            <Button
              onClick={() => createToken.mutate()}
              disabled={!tokenGroupId || (tokenType === '1' && !tokenChannelId) || createToken.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Temporary Password</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Password</Label>
              <div className="flex items-center gap-1.5 mt-1">
                <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Enter or generate a password" />
                <Button type="button" variant="outline" size="icon" onClick={() => setPw(randomPassword())} title="Generate random password">
                  <Dices className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input className="mt-1" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Valid For</Label>
                <Input type="number" className="mt-1" min={1} value={durationValue} onChange={(e) => setDurationValue(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Unit</Label>
                <Select value={durationUnit} onValueChange={setDurationUnit}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DURATION_UNITS.map((u) => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Target Channel</Label>
              <Select value={targetCid} onValueChange={setTargetCid}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Default Channel</SelectItem>
                  {channels.map((ch) => <SelectItem key={ch.cid} value={String(ch.cid)}>{ch.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createTemp.mutate()}
              disabled={!pw.trim() || !durationValue || Number(durationValue) <= 0 || createTemp.isPending}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
