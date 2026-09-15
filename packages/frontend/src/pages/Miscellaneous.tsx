import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '@/api/servers.api';
import { useServerStore } from '@/stores/server.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { MessageSquare, UserRound, Camera, AlertTriangle, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

export default function Miscellaneous() {
  const { selectedConfigId, selectedSid } = useServerStore();
  const qc = useQueryClient();

  // Global Message
  const [msgTarget, setMsgTarget] = useState<'all' | 'this'>('all');
  const [msgText, setMsgText] = useState('');
  const sendGlobal = useMutation({
    mutationFn: (msg: string) => serversApi.sendGlobalMessage(selectedConfigId!, msg),
  });
  const sendToServer = useMutation({
    mutationFn: (msg: string) => serversApi.sendServerMessage(selectedConfigId!, selectedSid!, msg),
  });

  // Identity
  const { data: identity } = useQuery({
    queryKey: ['identity', selectedConfigId, selectedSid],
    queryFn: () => serversApi.getIdentity(selectedConfigId!, selectedSid),
    enabled: !!selectedConfigId,
  });
  const [nickname, setNickname] = useState('');
  const setIdentity = useMutation({
    mutationFn: (n: string) => serversApi.setIdentity(selectedConfigId!, n, selectedSid),
    onSuccess: () => {
      toast.success('Identity updated');
      qc.invalidateQueries({ queryKey: ['identity', selectedConfigId, selectedSid] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to update identity'),
  });

  const { data: serverConfig } = useQuery({
    queryKey: ['server-config', selectedConfigId],
    queryFn: () => serversApi.get(selectedConfigId!),
    enabled: !!selectedConfigId,
  });
  const [homeChannelId, setHomeChannelId] = useState('');
  const setHomeChannel = useMutation({
    mutationFn: (cid: string) => serversApi.update(selectedConfigId!, { queryHomeChannelId: cid.trim() ? parseInt(cid, 10) : null }),
    onSuccess: () => {
      toast.success('Home channel updated - applies on the next reconnect');
      qc.invalidateQueries({ queryKey: ['server-config', selectedConfigId] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to update home channel'),
  });

  // Snapshots
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createSnapshot = useMutation({
    mutationFn: () => serversApi.createSnapshot(selectedConfigId!, selectedSid!),
    onSuccess: (data: any) => {
      const payload = Array.isArray(data) ? data[0] : data;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snapshot-server-${selectedSid}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Snapshot created and downloaded');
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to create snapshot'),
  });
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const deploySnapshot = useMutation({
    mutationFn: (data: any) => serversApi.deploySnapshot(selectedConfigId!, selectedSid!, data),
    onSuccess: () => {
      toast.success('Snapshot restored');
      setShowRestoreConfirm(false);
      setRestoreFile(null);
      qc.invalidateQueries({ queryKey: ['virtual-server-info'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to restore snapshot');
      setShowRestoreConfirm(false);
    },
  });

  // Permission reset
  const [showPermResetConfirm, setShowPermResetConfirm] = useState(false);
  const resetPermissions = useMutation({
    mutationFn: () => serversApi.resetPermissions(selectedConfigId!, selectedSid!),
    onSuccess: () => {
      toast.success('Permissions reset to defaults');
      setShowPermResetConfirm(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to reset permissions');
      setShowPermResetConfirm(false);
    },
  });

  if (!selectedConfigId || !selectedSid) {
    return <EmptyState icon={MessageSquare} title="No server selected" description="Select a server under Virtual Servers first." />;
  }

  const handleSend = () => {
    if (!msgText.trim()) return;
    const mutation = msgTarget === 'all' ? sendGlobal : sendToServer;
    mutation.mutate(msgText, {
      onSuccess: () => { toast.success('Message sent'); setMsgText(''); },
      onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to send message'),
    });
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setRestoreFile(file); setShowRestoreConfirm(true); }
    e.target.value = '';
  };

  const confirmRestore = async () => {
    if (!restoreFile) return;
    const text = await restoreFile.text();
    try {
      const data = JSON.parse(text);
      deploySnapshot.mutate(data);
    } catch {
      toast.error('Not a valid snapshot file');
      setShowRestoreConfirm(false);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Miscellaneous</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> Global Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder="Important announcement..."
              rows={3}
              className="text-sm"
            />
            <div className="flex items-center gap-2">
              <Select value={msgTarget} onValueChange={(v) => setMsgTarget(v as 'all' | 'this')}>
                <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Servers</SelectItem>
                  <SelectItem value="this" disabled={!selectedSid}>This Server Only</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex-1" />
              <Button size="sm" onClick={handleSend} disabled={!msgText.trim() || sendGlobal.isPending || sendToServer.isPending}>
                Send
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {msgTarget === 'all'
                ? 'Sent anonymously as "server" to every virtual server on this instance.'
                : 'Sent under your current query identity (see below) to this server only - not anonymous.'}
            </p>
          </CardContent>
        </Card>

        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" /> Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              The nickname your manual actions through this app (e.g. renaming a channel) show as in TeamSpeak's own logs. Separate from any per-server Bot Identity, which only covers bot-flow actions.
            </p>
            <div>
              <Label className="text-xs">Current: {identity?.client_nickname || '...'}</Label>
              <div className="flex gap-2 mt-1">
                <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={identity?.client_nickname || 'New nickname'} className="h-8 text-sm" />
                <Button size="sm" onClick={() => setIdentity.mutate(nickname, { onSuccess: () => setNickname('') })} disabled={!nickname.trim() || setIdentity.isPending}>
                  Save
                </Button>
              </div>
            </div>

            <div className="pt-1 border-t border-border/50">
              <p className="text-[11px] text-muted-foreground mb-2">
                Which channel this identity appears to "sit in" - purely cosmetic/technical, no functional effect. Leave empty to use whatever TeamSpeak assigns by default.
              </p>
              <Label className="text-xs">Home Channel ID {serverConfig?.queryHomeChannelId != null && `(current: ${serverConfig.queryHomeChannelId})`}</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number"
                  value={homeChannelId}
                  onChange={(e) => setHomeChannelId(e.target.value)}
                  placeholder={serverConfig?.queryHomeChannelId != null ? String(serverConfig.queryHomeChannelId) : 'Default'}
                  className="h-8 text-sm"
                />
                <Button size="sm" onClick={() => setHomeChannel.mutate(homeChannelId, { onSuccess: () => setHomeChannelId('') })} disabled={setHomeChannel.isPending}>
                  Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Camera className="h-4 w-4 text-primary" /> Snapshots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Saves all settings, groups, and known client identities of the currently selected server. Files, icons, and avatars are not included.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => createSnapshot.mutate()} disabled={!selectedSid || createSnapshot.isPending}>
                <Download className="h-3.5 w-3.5 mr-1" /> {createSnapshot.isPending ? 'Creating...' : 'Create & Download'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={!selectedSid}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Restore from File
              </Button>
              <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={handleRestoreFile} />
            </div>
            <p className="text-[11px] text-muted-foreground">Restoring overwrites the currently selected server's settings, groups, and permissions.</p>
          </CardContent>
        </Card>

        <Card className="card-hero border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" /> Danger Zone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Deletes every group, client, and channel permission on the currently selected server, then recreates the default template groups. Cannot be undone.
            </p>
            <Button variant="destructive" size="sm" onClick={() => setShowPermResetConfirm(true)} disabled={!selectedSid}>
              Reset All Permissions
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={showRestoreConfirm}
        onOpenChange={(v) => { if (!v) { setShowRestoreConfirm(false); setRestoreFile(null); } }}
        title="Restore Snapshot?"
        description={`This overwrites the currently selected server's settings, groups, and permissions with the contents of "${restoreFile?.name}". This cannot be undone.`}
        confirmLabel="Restore"
        destructive
        onConfirm={confirmRestore}
        loading={deploySnapshot.isPending}
      />

      <ConfirmDialog
        open={showPermResetConfirm}
        onOpenChange={setShowPermResetConfirm}
        title="Reset All Permissions?"
        description="This permanently deletes every server group, channel group, client, and channel permission on the currently selected server, then recreates the default template groups. This cannot be undone."
        confirmLabel="Reset Permissions"
        destructive
        onConfirm={() => resetPermissions.mutate()}
        loading={resetPermissions.isPending}
      />
    </div>
  );
}
