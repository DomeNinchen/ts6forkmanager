import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      toast.success(t('pages.misc.identityUpdated'));
      qc.invalidateQueries({ queryKey: ['identity', selectedConfigId, selectedSid] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.misc.identityUpdateFailed')),
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
      toast.success(t('pages.misc.snapshotCreated'));
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.misc.snapshotCreateFailed')),
  });
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const deploySnapshot = useMutation({
    mutationFn: (data: any) => serversApi.deploySnapshot(selectedConfigId!, selectedSid!, data),
    onSuccess: () => {
      toast.success(t('pages.misc.snapshotRestored'));
      setShowRestoreConfirm(false);
      setRestoreFile(null);
      qc.invalidateQueries({ queryKey: ['virtual-server-info'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.misc.snapshotRestoreFailed'));
      setShowRestoreConfirm(false);
    },
  });

  // Permission reset
  const [showPermResetConfirm, setShowPermResetConfirm] = useState(false);
  const resetPermissions = useMutation({
    mutationFn: () => serversApi.resetPermissions(selectedConfigId!, selectedSid!),
    onSuccess: () => {
      toast.success(t('pages.misc.permissionsReset'));
      setShowPermResetConfirm(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.misc.permissionsResetFailed'));
      setShowPermResetConfirm(false);
    },
  });

  if (!selectedConfigId || !selectedSid) {
    return <EmptyState icon={MessageSquare} title={t('pages.noServerSelected')} description={t('pages.serverStats.selectServerFirst')} />;
  }

  const handleSend = () => {
    if (!msgText.trim()) return;
    const mutation = msgTarget === 'all' ? sendGlobal : sendToServer;
    mutation.mutate(msgText, {
      onSuccess: () => { toast.success(t('pages.misc.messageSent')); setMsgText(''); },
      onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.misc.messageSendFailed')),
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
      toast.error(t('pages.misc.notValidSnapshot'));
      setShowRestoreConfirm(false);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('nav.items.miscellaneous')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> {t('pages.misc.globalMessage')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={msgText}
              onChange={(e) => setMsgText(e.target.value)}
              placeholder={t('pages.misc.announcementPlaceholder')}
              rows={3}
              className="text-sm"
            />
            <div className="flex items-center gap-2">
              <Select value={msgTarget} onValueChange={(v) => setMsgTarget(v as 'all' | 'this')}>
                <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('pages.misc.allServers')}</SelectItem>
                  <SelectItem value="this" disabled={!selectedSid}>{t('pages.misc.thisServerOnly')}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex-1" />
              <Button size="sm" onClick={handleSend} disabled={!msgText.trim() || sendGlobal.isPending || sendToServer.isPending}>
                {t('pages.messages.send')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {msgTarget === 'all'
                ? t('pages.misc.sentAnonymously')
                : t('pages.misc.sentUnderIdentity')}
            </p>
          </CardContent>
        </Card>

        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" /> {t('pages.misc.identity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              {t('pages.misc.identityDescription')}
            </p>
            <div>
              <Label className="text-xs">{t('pages.misc.current', { name: identity?.client_nickname || '...' })}</Label>
              <div className="flex gap-2 mt-1">
                <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={identity?.client_nickname || t('pages.misc.newNickname')} className="h-8 text-sm" />
                <Button size="sm" onClick={() => setIdentity.mutate(nickname, { onSuccess: () => setNickname('') })} disabled={!nickname.trim() || setIdentity.isPending}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Camera className="h-4 w-4 text-primary" /> {t('pages.misc.snapshots')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              {t('pages.misc.snapshotsDescription')}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => createSnapshot.mutate()} disabled={!selectedSid || createSnapshot.isPending}>
                <Download className="h-3.5 w-3.5 mr-1" /> {createSnapshot.isPending ? t('pages.misc.creating') : t('pages.misc.createAndDownload')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={!selectedSid}>
                <Upload className="h-3.5 w-3.5 mr-1" /> {t('pages.misc.restoreFromFile')}
              </Button>
              <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={handleRestoreFile} />
            </div>
            <p className="text-[11px] text-muted-foreground">{t('pages.misc.restoreWarning')}</p>
          </CardContent>
        </Card>

        <Card className="card-hero border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" /> {t('pages.misc.dangerZone')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              {t('pages.misc.dangerZoneDescription')}
            </p>
            <Button variant="destructive" size="sm" onClick={() => setShowPermResetConfirm(true)} disabled={!selectedSid}>
              {t('pages.misc.resetAllPermissions')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={showRestoreConfirm}
        onOpenChange={(v) => { if (!v) { setShowRestoreConfirm(false); setRestoreFile(null); } }}
        title={t('pages.misc.restoreSnapshotTitle')}
        description={t('pages.misc.restoreSnapshotDescription', { name: restoreFile?.name })}
        confirmLabel={t('pages.misc.restore')}
        destructive
        onConfirm={confirmRestore}
        loading={deploySnapshot.isPending}
      />

      <ConfirmDialog
        open={showPermResetConfirm}
        onOpenChange={setShowPermResetConfirm}
        title={t('pages.misc.resetAllPermissionsTitle')}
        description={t('pages.misc.resetAllPermissionsDescription')}
        confirmLabel={t('pages.misc.resetAllPermissions')}
        destructive
        onConfirm={() => resetPermissions.mutate()}
        loading={resetPermissions.isPending}
      />
    </div>
  );
}
