import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { normalizeIconId } from '@ts6/common';
import { tokensApi, tempPasswordsApi } from '@/api/bans.api';
import { channelsApi } from '@/api/channels.api';
import { groupsApi } from '@/api/groups.api';
import { IconImage } from '@/components/icons/IconImage';
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

const DURATION_UNIT_SECONDS: Record<string, number> = { minutes: 60, hours: 3600, days: 86400 };

function randomPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function Tokens() {
  const { t } = useTranslation();
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
      toast.success(token ? t('pages.tokens.createdAndCopied') : t('pages.tokens.created'));
      qc.invalidateQueries({ queryKey: ['tokens'] });
      setShowCreateToken(false);
      setTokenGroupId(''); setTokenChannelId(''); setTokenDesc('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.tokens.createFailed')),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [pw, setPw] = useState('');
  const [desc, setDesc] = useState('');
  const [durationValue, setDurationValue] = useState('1');
  const [durationUnit, setDurationUnit] = useState('hours');
  const [targetCid, setTargetCid] = useState('0');

  const createTemp = useMutation({
    mutationFn: () => {
      const unitSeconds = DURATION_UNIT_SECONDS[durationUnit];
      return tempPasswordsApi.add(c!, s!, {
        pw, desc, duration: Number(durationValue) * unitSeconds, tcid: Number(targetCid),
      });
    },
    onSuccess: () => {
      toast.success(t('pages.tokens.tempCreated'));
      qc.invalidateQueries({ queryKey: ['temp-passwords'] });
      setShowCreate(false);
      setPw(''); setDesc(''); setDurationValue('1'); setDurationUnit('hours'); setTargetCid('0');
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.tokens.tempCreateFailed')),
  });
  const deleteTemp = useMutation({
    mutationFn: (password: string) => tempPasswordsApi.delete(c!, s!, password),
    onSuccess: () => { toast.success(t('pages.tokens.tempDeleted')); qc.invalidateQueries({ queryKey: ['temp-passwords'] }); },
  });

  const tokens = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const tempPasswords = useMemo(() => (Array.isArray(tempData) ? tempData : []), [tempData]);
  const channels = useMemo(() => {
    if (!Array.isArray(channelData)) return [];
    return channelData.map((ch: any) => ({ cid: Number(ch.cid), name: ch.channel_name }));
  }, [channelData]);
  const channelName = (cid: number) => (cid === 0 ? t('pages.tokens.defaultChannel') : channels.find((ch) => ch.cid === cid)?.name || `#${cid}`);
  // Only regular groups (type 1) can be targeted by a token - confirmed live:
  // template groups (type 0) fail with "invalid group ID", and server query
  // groups (type 2) fail with "invalid parameter". Channel groups have no
  // query type, so this filter is a no-op there beyond excluding templates.
  const serverGroupList = useMemo(() => (Array.isArray(serverGroupData) ? serverGroupData : [])
    .filter((g: any) => Number(g.type) === 1)
    .map((g: any) => ({ id: Number(g.sgid), name: g.name, iconId: normalizeIconId(g.iconid) })), [serverGroupData]);
  const channelGroupList = useMemo(() => (Array.isArray(channelGroupData) ? channelGroupData : [])
    .filter((g: any) => Number(g.type) === 1)
    .map((g: any) => ({ id: Number(g.cgid), name: g.name, iconId: normalizeIconId(g.iconid) })), [channelGroupData]);

  const columns: ColumnDef<DataTableFeatures, any>[] = useMemo(() => [
    { accessorKey: 'token', header: t('pages.tokens.token'), cell: ({ getValue }) => (
      <div className="flex items-center gap-1">
        <span className="font-mono-data text-xs truncate max-w-[200px]">{getValue() as string}</span>
        <button onClick={() => { navigator.clipboard.writeText(getValue() as string); toast.success(t('common.copied')); }} className="p-1 hover:bg-muted rounded-sm"><Copy className="h-3 w-3 text-muted-foreground" /></button>
      </div>
    )},
    { accessorKey: 'token_type', header: t('common.type'), cell: ({ getValue }) => <span className="text-xs">{(getValue() as number) === 0 ? t('pages.tokens.serverGroup') : t('pages.tokens.channelGroup')}</span> },
    { accessorKey: 'token_id1', header: t('pages.tokens.groupId'), cell: ({ getValue }) => <span className="font-mono-data text-xs">{getValue() as number}</span> },
    { accessorKey: 'token_description', header: t('common.description'), cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '-'}</span> },
    { id: 'actions', header: '', cell: ({ row }) => (
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteToken.mutate(row.original.token, { onSuccess: () => toast.success(t('pages.tokens.tokenDeleted')) })}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    )},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [deleteToken, t]);

  const tempColumns: ColumnDef<DataTableFeatures, any>[] = useMemo(() => [
    { accessorKey: 'pw_clear', header: t('common.password'), cell: ({ getValue }) => (
      <div className="flex items-center gap-1">
        <span className="font-mono-data text-xs">{getValue() as string}</span>
        <button onClick={() => { navigator.clipboard.writeText(getValue() as string); toast.success(t('common.copied')); }} className="p-1 hover:bg-muted rounded-sm"><Copy className="h-3 w-3 text-muted-foreground" /></button>
      </div>
    )},
    { accessorKey: 'desc', header: t('common.description'), cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) || '-'}</span> },
    { accessorKey: 'tcid', header: t('pages.tokens.targetChannel'), cell: ({ getValue }) => <span className="text-xs">{channelName(Number(getValue()))}</span> },
    { accessorKey: 'end', header: t('pages.tokens.expires'), cell: ({ getValue }) => {
      const remaining = Number(getValue()) - Math.floor(Date.now() / 1000);
      return (
        <span className={cn('text-xs font-mono-data flex items-center gap-1', remaining <= 0 && 'text-destructive')}>
          <Clock className="h-3 w-3" /> {remaining > 0 ? formatDuration(remaining) : t('pages.tokens.expired')}
        </span>
      );
    }},
    { accessorKey: 'nickname', header: t('pages.tokens.createdBy'), cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue() as string}</span> },
    { id: 'actions', header: '', cell: ({ row }) => (
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteTemp.mutate(row.original.pw_clear)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    )},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [deleteTemp, channels, t]);

  if (!c || !s) return <EmptyState icon={KeyRound} title={t('pages.noServerSelected')} />;
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('pages.tokens.title')}</h1>
        <Button size="sm" onClick={() => setShowCreateToken(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> {t('pages.tokens.createToken')}
        </Button>
      </div>
      <DataTable columns={columns} data={tokens} searchKey="token_description" searchPlaceholder={t('pages.tokens.searchTokens')} />

      <Card className="card-hero">
        <CardHeader className="pb-2 flex items-center justify-between flex-row">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('pages.tokens.temporaryPasswords')}</CardTitle>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> {t('common.create')}
          </Button>
        </CardHeader>
        <CardContent>
          {loadingTemp ? (
            <PageLoader />
          ) : tempPasswords.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t('pages.tokens.noTempPasswords')}</p>
          ) : (
            <DataTable columns={tempColumns} data={tempPasswords} searchKey="desc" searchPlaceholder={t('pages.tokens.searchTempPasswords')} />
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateToken} onOpenChange={setShowCreateToken}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.tokens.createToken')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('pages.tokens.groupType')}</Label>
              <Select value={tokenType} onValueChange={(v) => { setTokenType(v); setTokenGroupId(''); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('pages.tokens.serverGroup')}</SelectItem>
                  <SelectItem value="1">{t('pages.tokens.channelGroup')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('pages.tokens.group')}</Label>
              <Select value={tokenGroupId} onValueChange={setTokenGroupId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={t('pages.tokens.chooseGroup')} /></SelectTrigger>
                <SelectContent>
                  {(tokenType === '0' ? serverGroupList : channelGroupList).map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      <span className="flex items-center gap-1.5">
                        <IconImage iconId={g.iconId} size={14} alt={t('pages.tokens.iconForGroup', { name: g.name })} />
                        {g.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {tokenType === '1' && (
              <div>
                <Label className="text-xs">{t('nav.items.channels')}</Label>
                <Select value={tokenChannelId} onValueChange={setTokenChannelId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder={t('pages.clients.chooseChannel')} /></SelectTrigger>
                  <SelectContent>
                    {channels.map((ch) => (
                      <SelectItem key={ch.cid} value={String(ch.cid)}>{ch.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">{t('common.description')}</Label>
              <Input className="mt-1" value={tokenDesc} onChange={(e) => setTokenDesc(e.target.value)} placeholder={t('common.optional')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateToken(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => createToken.mutate()}
              disabled={!tokenGroupId || (tokenType === '1' && !tokenChannelId) || createToken.isPending}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.tokens.createTempPassword')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('common.password')}</Label>
              <div className="flex items-center gap-1.5 mt-1">
                <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('pages.tokens.enterOrGenerate')} />
                <Button type="button" variant="outline" size="icon" onClick={() => setPw(randomPassword())} title={t('pages.tokens.generateRandom')}>
                  <Dices className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">{t('common.description')}</Label>
              <Input className="mt-1" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('common.optional')} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">{t('pages.tokens.validFor')}</Label>
                <Input type="number" className="mt-1" min={1} value={durationValue} onChange={(e) => setDurationValue(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t('pages.tokens.unit')}</Label>
                <Select value={durationUnit} onValueChange={setDurationUnit}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">{t('pages.tokens.minutes')}</SelectItem>
                    <SelectItem value="hours">{t('pages.tokens.hours')}</SelectItem>
                    <SelectItem value="days">{t('pages.tokens.days')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">{t('pages.tokens.targetChannel')}</Label>
              <Select value={targetCid} onValueChange={setTargetCid}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('pages.tokens.defaultChannel')}</SelectItem>
                  {channels.map((ch) => <SelectItem key={ch.cid} value={String(ch.cid)}>{ch.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => createTemp.mutate()}
              disabled={!pw.trim() || !durationValue || Number(durationValue) <= 0 || createTemp.isPending}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
