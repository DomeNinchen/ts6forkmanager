import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeIconId } from '@ts6/common';
import { IconImage } from '@/components/icons/IconImage';
import { useServerStore } from '@/stores/server.store';
import { useVirtualServerInfo, useEditVirtualServer } from '@/hooks/use-servers';
import { useServerGroups, useChannelGroups } from '@/hooks/use-groups';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

const LIMITS_FIELDS = [
  'virtualserver_upload_quota', 'virtualserver_download_quota',
  'virtualserver_max_upload_total_bandwidth', 'virtualserver_max_download_total_bandwidth',
];

function pick(form: Record<string, any>, keys: string[]) {
  const out: Record<string, any> = {};
  for (const k of keys) out[k] = form[k];
  return out;
}

function NumField({ label, hint, value, onChange }: { label: string; hint?: string; value: any; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="h-8 text-sm mt-1" />
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function LogSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export default function AdvancedServerSettings() {
  const { t } = useTranslation();
  const as = (key: string) => t(`pages.advancedSettings.${key}`);
  const { selectedConfigId, selectedSid } = useServerStore();
  const { data: info, isLoading } = useVirtualServerInfo();
  const { data: serverGroups } = useServerGroups();
  const { data: channelGroups } = useChannelGroups();
  const editServer = useEditVirtualServer();

  const s = Array.isArray(info) ? info[0] : info;
  const [form, setForm] = useState<Record<string, any> | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (s && !form) setForm({ ...s });
  }, [s, form]);

  if (!selectedConfigId || !selectedSid) {
    return <EmptyState icon={SlidersHorizontal} title={t('pages.noServerSelected')} description={t('pages.serverStats.selectServerFirst')} />;
  }
  if (isLoading || !form) return <PageLoader />;

  const set = (key: string, value: any) => setForm((f) => ({ ...(f ?? {}), [key]: value }));

  const save = (fields: string[], extra?: Record<string, any>) => {
    editServer.mutate(
      { ...pick(form, fields), ...extra },
      {
        onSuccess: () => toast.success(t('pages.advancedSettings.saved')),
        onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.advancedSettings.saveFailed')),
      },
    );
  };

  const sGroups = Array.isArray(serverGroups) ? serverGroups : [];
  const cGroups = Array.isArray(channelGroups) ? channelGroups : [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{as('title')}</h1>

      <Tabs defaultValue="appearance">
        <TabsList>
          <TabsTrigger value="appearance">{as('tabs.appearance')}</TabsTrigger>
          <TabsTrigger value="access">{as('tabs.access')}</TabsTrigger>
          <TabsTrigger value="moderation">{as('tabs.moderation')}</TabsTrigger>
          <TabsTrigger value="limits">{as('tabs.limits')}</TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="mt-4 space-y-4">
          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('welcomeHostMessage')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">{as('welcomeMessage')}</Label>
                <Textarea value={form.virtualserver_welcomemessage ?? ''} onChange={(e) => set('virtualserver_welcomemessage', e.target.value)} rows={2} className="text-sm mt-1" placeholder={as('welcomeMessagePlaceholder')} />
              </div>
              <div>
                <Label className="text-xs">{as('hostMessage')}</Label>
                <Input value={form.virtualserver_hostmessage ?? ''} onChange={(e) => set('virtualserver_hostmessage', e.target.value)} className="h-8 text-sm mt-1" />
              </div>
              <div>
                <Label className="text-xs">{as('hostMessageMode')}</Label>
                <Select value={String(form.virtualserver_hostmessage_mode ?? '0')} onValueChange={(v) => set('virtualserver_hostmessage_mode', Number(v))}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{as('dontShow')}</SelectItem>
                    <SelectItem value="1">{as('showInChatLog')}</SelectItem>
                    <SelectItem value="2">{as('showAsModal')}</SelectItem>
                    <SelectItem value="3">{as('showAsModalThenQuit')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_welcomemessage', 'virtualserver_hostmessage', 'virtualserver_hostmessage_mode'])} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('hostBanner')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label className="text-xs">{as('linkUrl')}</Label><Input value={form.virtualserver_hostbanner_url ?? ''} onChange={(e) => set('virtualserver_hostbanner_url', e.target.value)} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">{as('imageUrl')}</Label><Input value={form.virtualserver_hostbanner_gfx_url ?? ''} onChange={(e) => set('virtualserver_hostbanner_gfx_url', e.target.value)} className="h-8 text-sm mt-1" /></div>
                <NumField label={as('rotationInterval')} value={form.virtualserver_hostbanner_gfx_interval} onChange={(v) => set('virtualserver_hostbanner_gfx_interval', Number(v))} />
                <div>
                  <Label className="text-xs">{as('displayMode')}</Label>
                  <Select value={String(form.virtualserver_hostbanner_mode ?? '0')} onValueChange={(v) => set('virtualserver_hostbanner_mode', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">{as('noAdjust')}</SelectItem>
                      <SelectItem value="1">{as('stretchIgnoreAspect')}</SelectItem>
                      <SelectItem value="2">{as('keepAspectRatio')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_hostbanner_url', 'virtualserver_hostbanner_gfx_url', 'virtualserver_hostbanner_gfx_interval', 'virtualserver_hostbanner_mode'])} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('hostButton')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label className="text-xs">{as('linkUrlOnClick')}</Label><Input value={form.virtualserver_hostbutton_url ?? ''} onChange={(e) => set('virtualserver_hostbutton_url', e.target.value)} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">{as('imageUrl')}</Label><Input value={form.virtualserver_hostbutton_gfx_url ?? ''} onChange={(e) => set('virtualserver_hostbutton_gfx_url', e.target.value)} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">{as('tooltip')}</Label><Input value={form.virtualserver_hostbutton_tooltip ?? ''} onChange={(e) => set('virtualserver_hostbutton_tooltip', e.target.value)} className="h-8 text-sm mt-1" /></div>
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_hostbutton_url', 'virtualserver_hostbutton_gfx_url', 'virtualserver_hostbutton_tooltip'])} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access" className="mt-4 space-y-4">
          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('defaultGroups')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">{as('defaultServerGroup')}</Label>
                  <Select value={String(form.virtualserver_default_server_group ?? '')} onValueChange={(v) => set('virtualserver_default_server_group', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{sGroups.map((g: any) => (
                      <SelectItem key={g.sgid} value={String(g.sgid)}>
                        <span className="flex items-center gap-1.5">
                          <IconImage iconId={normalizeIconId(g.iconid)} size={14} alt={t('pages.tokens.iconForGroup', { name: g.name })} />
                          {g.name}
                        </span>
                      </SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{as('defaultChannelGroup')}</Label>
                  <Select value={String(form.virtualserver_default_channel_group ?? '')} onValueChange={(v) => set('virtualserver_default_channel_group', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{cGroups.map((g: any) => (
                      <SelectItem key={g.cgid} value={String(g.cgid)}>
                        <span className="flex items-center gap-1.5">
                          <IconImage iconId={normalizeIconId(g.iconid)} size={14} alt={t('pages.tokens.iconForGroup', { name: g.name })} />
                          {g.name}
                        </span>
                      </SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{as('defaultChannelAdminGroup')}</Label>
                  <Select value={String(form.virtualserver_default_channel_admin_group ?? '')} onValueChange={(v) => set('virtualserver_default_channel_admin_group', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{cGroups.map((g: any) => (
                      <SelectItem key={g.cgid} value={String(g.cgid)}>
                        <span className="flex items-center gap-1.5">
                          <IconImage iconId={normalizeIconId(g.iconid)} size={14} alt={t('pages.tokens.iconForGroup', { name: g.name })} />
                          {g.name}
                        </span>
                      </SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_default_server_group', 'virtualserver_default_channel_group', 'virtualserver_default_channel_admin_group'])} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('accessSecurity')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{as('serverPassword')}</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('components.editChannelDialog.leaveEmptyToKeep')} className="h-8 text-sm mt-1" />
                </div>
                <NumField label={as('minIdentitySecurityLevel')} value={form.virtualserver_needed_identity_security_level} onChange={(v) => set('virtualserver_needed_identity_security_level', Number(v))} />
                <NumField label={as('minClientBuild')} value={form.virtualserver_min_client_version} onChange={(v) => set('virtualserver_min_client_version', Number(v))} />
                <NumField label={as('reservedSlots')} value={form.virtualserver_reserved_slots} onChange={(v) => set('virtualserver_reserved_slots', Number(v))} />
                <div>
                  <Label className="text-xs">{as('codecEncryption')}</Label>
                  <Select value={String(form.virtualserver_codec_encryption_mode ?? '0')} onValueChange={(v) => set('virtualserver_codec_encryption_mode', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">{as('perChannelSetting')}</SelectItem>
                      <SelectItem value="1">{as('forcedOff')}</SelectItem>
                      <SelectItem value="2">{as('forcedOn')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between md:pt-5">
                  <Label className="text-xs">{as('showOnGlobalWeblist')}</Label>
                  <Switch checked={Number(form.virtualserver_weblist_enabled) === 1} onCheckedChange={(v) => set('virtualserver_weblist_enabled', v ? 1 : 0)} />
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => save(
                  ['virtualserver_needed_identity_security_level', 'virtualserver_min_client_version', 'virtualserver_reserved_slots', 'virtualserver_codec_encryption_mode', 'virtualserver_weblist_enabled'],
                  password.trim() ? { virtualserver_password: password.trim() } : undefined,
                )}
                disabled={editServer.isPending}
              >
                {t('common.save')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="moderation" className="mt-4 space-y-4">
          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t('nav.items.complaints')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <NumField label={as('complaintsBeforeBan')} value={form.virtualserver_complain_autoban_count} onChange={(v) => set('virtualserver_complain_autoban_count', Number(v))} />
                <NumField label={as('banDurationSeconds')} value={form.virtualserver_complain_autoban_time} onChange={(v) => set('virtualserver_complain_autoban_time', Number(v))} />
                <NumField label={as('complaintRemovedAfter')} value={form.virtualserver_complain_remove_time} onChange={(v) => set('virtualserver_complain_remove_time', Number(v))} />
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_complain_autoban_count', 'virtualserver_complain_autoban_time', 'virtualserver_complain_remove_time'])} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('prioritySilence')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <NumField label={as('clientsBeforeForcedSilence')} value={form.virtualserver_min_clients_in_channel_before_forced_silence} onChange={(v) => set('virtualserver_min_clients_in_channel_before_forced_silence', Number(v))} />
                <NumField label={as('prioritySpeakerReduction')} value={form.virtualserver_priority_speaker_dimm_modificator} onChange={(v) => set('virtualserver_priority_speaker_dimm_modificator', Number(v))} />
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_min_clients_in_channel_before_forced_silence', 'virtualserver_priority_speaker_dimm_modificator'])} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('antiFlood')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <NumField label={as('pointsReducedGood')} value={form.virtualserver_antiflood_points_tick_reduce} onChange={(v) => set('virtualserver_antiflood_points_tick_reduce', Number(v))} />
                <NumField label={as('pointsToBlockCommands')} value={form.virtualserver_antiflood_points_needed_command_block} onChange={(v) => set('virtualserver_antiflood_points_needed_command_block', Number(v))} />
                <NumField label={as('pointsToBlockConnections')} value={form.virtualserver_antiflood_points_needed_ip_block} onChange={(v) => set('virtualserver_antiflood_points_needed_ip_block', Number(v))} />
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_antiflood_points_tick_reduce', 'virtualserver_antiflood_points_needed_command_block', 'virtualserver_antiflood_points_needed_ip_block'])} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('eventLogging')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2">
                <LogSwitch label={t('nav.items.clients')} checked={Number(form.virtualserver_log_client) === 1} onChange={(v) => set('virtualserver_log_client', v ? 1 : 0)} />
                <LogSwitch label={as('serverqueryClients')} checked={Number(form.virtualserver_log_query) === 1} onChange={(v) => set('virtualserver_log_query', v ? 1 : 0)} />
                <LogSwitch label={t('nav.items.channels')} checked={Number(form.virtualserver_log_channel) === 1} onChange={(v) => set('virtualserver_log_channel', v ? 1 : 0)} />
                <LogSwitch label={t('nav.items.permissions')} checked={Number(form.virtualserver_log_permissions) === 1} onChange={(v) => set('virtualserver_log_permissions', v ? 1 : 0)} />
                <LogSwitch label={as('serverChanges')} checked={Number(form.virtualserver_log_server) === 1} onChange={(v) => set('virtualserver_log_server', v ? 1 : 0)} />
                <LogSwitch label={as('fileTransfers')} checked={Number(form.virtualserver_log_filetransfer) === 1} onChange={(v) => set('virtualserver_log_filetransfer', v ? 1 : 0)} />
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_log_client', 'virtualserver_log_query', 'virtualserver_log_channel', 'virtualserver_log_permissions', 'virtualserver_log_server', 'virtualserver_log_filetransfer'])} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limits" className="mt-4 space-y-4">
          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{as('fileTransferLimitsPerUser')}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <NumField label={as('uploadQuotaMb')} hint={as('zeroUnlimited')} value={form.virtualserver_upload_quota} onChange={(v) => set('virtualserver_upload_quota', Number(v))} />
                <NumField label={as('downloadQuotaMb')} hint={as('zeroUnlimited')} value={form.virtualserver_download_quota} onChange={(v) => set('virtualserver_download_quota', Number(v))} />
                <NumField label={as('uploadBandwidth')} hint={as('zeroUnlimited')} value={form.virtualserver_max_upload_total_bandwidth} onChange={(v) => set('virtualserver_max_upload_total_bandwidth', Number(v))} />
                <NumField label={as('downloadBandwidth')} hint={as('zeroUnlimited')} value={form.virtualserver_max_download_total_bandwidth} onChange={(v) => set('virtualserver_max_download_total_bandwidth', Number(v))} />
              </div>
              <Button size="sm" onClick={() => save(LIMITS_FIELDS)} disabled={editServer.isPending}>{t('common.save')}</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
