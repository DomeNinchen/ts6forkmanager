import { useEffect, useState } from 'react';
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
    return <EmptyState icon={SlidersHorizontal} title="No server selected" description="Select a server under Virtual Servers first." />;
  }
  if (isLoading || !form) return <PageLoader />;

  const set = (key: string, value: any) => setForm((f) => ({ ...(f ?? {}), [key]: value }));

  const save = (fields: string[], extra?: Record<string, any>) => {
    editServer.mutate(
      { ...pick(form, fields), ...extra },
      {
        onSuccess: () => toast.success('Saved'),
        onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to save'),
      },
    );
  };

  const sGroups = Array.isArray(serverGroups) ? serverGroups : [];
  const cGroups = Array.isArray(channelGroups) ? channelGroups : [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Advanced Settings</h1>

      <Tabs defaultValue="appearance">
        <TabsList>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="access">Access &amp; Groups</TabsTrigger>
          <TabsTrigger value="moderation">Moderation &amp; Logging</TabsTrigger>
          <TabsTrigger value="limits">File Transfer Limits</TabsTrigger>
        </TabsList>

        <TabsContent value="appearance" className="mt-4 space-y-4">
          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Welcome &amp; Host Message</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Welcome Message</Label>
                <Textarea value={form.virtualserver_welcomemessage ?? ''} onChange={(e) => set('virtualserver_welcomemessage', e.target.value)} rows={2} className="text-sm mt-1" placeholder="Shown to clients right after they connect" />
              </div>
              <div>
                <Label className="text-xs">Host Message</Label>
                <Input value={form.virtualserver_hostmessage ?? ''} onChange={(e) => set('virtualserver_hostmessage', e.target.value)} className="h-8 text-sm mt-1" />
              </div>
              <div>
                <Label className="text-xs">Host Message Mode</Label>
                <Select value={String(form.virtualserver_hostmessage_mode ?? '0')} onValueChange={(v) => set('virtualserver_hostmessage_mode', Number(v))}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Don't show</SelectItem>
                    <SelectItem value="1">Show in chat log</SelectItem>
                    <SelectItem value="2">Show as modal</SelectItem>
                    <SelectItem value="3">Show as modal, then quit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_welcomemessage', 'virtualserver_hostmessage', 'virtualserver_hostmessage_mode'])} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Host Banner</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label className="text-xs">Link URL</Label><Input value={form.virtualserver_hostbanner_url ?? ''} onChange={(e) => set('virtualserver_hostbanner_url', e.target.value)} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Image URL</Label><Input value={form.virtualserver_hostbanner_gfx_url ?? ''} onChange={(e) => set('virtualserver_hostbanner_gfx_url', e.target.value)} className="h-8 text-sm mt-1" /></div>
                <NumField label="Rotation Interval (s)" value={form.virtualserver_hostbanner_gfx_interval} onChange={(v) => set('virtualserver_hostbanner_gfx_interval', Number(v))} />
                <div>
                  <Label className="text-xs">Display Mode</Label>
                  <Select value={String(form.virtualserver_hostbanner_mode ?? '0')} onValueChange={(v) => set('virtualserver_hostbanner_mode', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No adjust</SelectItem>
                      <SelectItem value="1">Stretch (ignore aspect ratio)</SelectItem>
                      <SelectItem value="2">Keep aspect ratio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_hostbanner_url', 'virtualserver_hostbanner_gfx_url', 'virtualserver_hostbanner_gfx_interval', 'virtualserver_hostbanner_mode'])} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Host Button</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label className="text-xs">Link URL (opened on click)</Label><Input value={form.virtualserver_hostbutton_url ?? ''} onChange={(e) => set('virtualserver_hostbutton_url', e.target.value)} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Image URL</Label><Input value={form.virtualserver_hostbutton_gfx_url ?? ''} onChange={(e) => set('virtualserver_hostbutton_gfx_url', e.target.value)} className="h-8 text-sm mt-1" /></div>
                <div><Label className="text-xs">Tooltip</Label><Input value={form.virtualserver_hostbutton_tooltip ?? ''} onChange={(e) => set('virtualserver_hostbutton_tooltip', e.target.value)} className="h-8 text-sm mt-1" /></div>
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_hostbutton_url', 'virtualserver_hostbutton_gfx_url', 'virtualserver_hostbutton_tooltip'])} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access" className="mt-4 space-y-4">
          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Default Groups</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Default Server Group</Label>
                  <Select value={String(form.virtualserver_default_server_group ?? '')} onValueChange={(v) => set('virtualserver_default_server_group', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{sGroups.map((g: any) => (
                      <SelectItem key={g.sgid} value={String(g.sgid)}>
                        <span className="flex items-center gap-1.5">
                          <IconImage iconId={normalizeIconId(g.iconid)} size={14} alt={`Icon for ${g.name}`} />
                          {g.name}
                        </span>
                      </SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Default Channel Group</Label>
                  <Select value={String(form.virtualserver_default_channel_group ?? '')} onValueChange={(v) => set('virtualserver_default_channel_group', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{cGroups.map((g: any) => (
                      <SelectItem key={g.cgid} value={String(g.cgid)}>
                        <span className="flex items-center gap-1.5">
                          <IconImage iconId={normalizeIconId(g.iconid)} size={14} alt={`Icon for ${g.name}`} />
                          {g.name}
                        </span>
                      </SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Default Channel Admin Group</Label>
                  <Select value={String(form.virtualserver_default_channel_admin_group ?? '')} onValueChange={(v) => set('virtualserver_default_channel_admin_group', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{cGroups.map((g: any) => (
                      <SelectItem key={g.cgid} value={String(g.cgid)}>
                        <span className="flex items-center gap-1.5">
                          <IconImage iconId={normalizeIconId(g.iconid)} size={14} alt={`Icon for ${g.name}`} />
                          {g.name}
                        </span>
                      </SelectItem>
                    ))}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_default_server_group', 'virtualserver_default_channel_group', 'virtualserver_default_channel_admin_group'])} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Access &amp; Security</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Server Password</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave empty to keep unchanged" className="h-8 text-sm mt-1" />
                </div>
                <NumField label="Minimum Identity Security Level" value={form.virtualserver_needed_identity_security_level} onChange={(v) => set('virtualserver_needed_identity_security_level', Number(v))} />
                <NumField label="Minimum Client Build" value={form.virtualserver_min_client_version} onChange={(v) => set('virtualserver_min_client_version', Number(v))} />
                <NumField label="Reserved Slots" value={form.virtualserver_reserved_slots} onChange={(v) => set('virtualserver_reserved_slots', Number(v))} />
                <div>
                  <Label className="text-xs">Codec Encryption</Label>
                  <Select value={String(form.virtualserver_codec_encryption_mode ?? '0')} onValueChange={(v) => set('virtualserver_codec_encryption_mode', Number(v))}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Per-channel setting</SelectItem>
                      <SelectItem value="1">Forced off</SelectItem>
                      <SelectItem value="2">Forced on</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between md:pt-5">
                  <Label className="text-xs">Show on Global Weblist</Label>
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
                Save
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="moderation" className="mt-4 space-y-4">
          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Complaints</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <NumField label="Complaints Before Ban" value={form.virtualserver_complain_autoban_count} onChange={(v) => set('virtualserver_complain_autoban_count', Number(v))} />
                <NumField label="Ban Duration (s)" value={form.virtualserver_complain_autoban_time} onChange={(v) => set('virtualserver_complain_autoban_time', Number(v))} />
                <NumField label="Complaint Removed After (s)" value={form.virtualserver_complain_remove_time} onChange={(v) => set('virtualserver_complain_remove_time', Number(v))} />
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_complain_autoban_count', 'virtualserver_complain_autoban_time', 'virtualserver_complain_remove_time'])} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Priority &amp; Silence</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <NumField label="Clients in Channel Before Forced Silence" value={form.virtualserver_min_clients_in_channel_before_forced_silence} onChange={(v) => set('virtualserver_min_clients_in_channel_before_forced_silence', Number(v))} />
                <NumField label="Priority Speaker Volume Reduction (dB)" value={form.virtualserver_priority_speaker_dimm_modificator} onChange={(v) => set('virtualserver_priority_speaker_dimm_modificator', Number(v))} />
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_min_clients_in_channel_before_forced_silence', 'virtualserver_priority_speaker_dimm_modificator'])} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Anti-Flood</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <NumField label="Points Reduced for Being Good" value={form.virtualserver_antiflood_points_tick_reduce} onChange={(v) => set('virtualserver_antiflood_points_tick_reduce', Number(v))} />
                <NumField label="Points to Block Commands" value={form.virtualserver_antiflood_points_needed_command_block} onChange={(v) => set('virtualserver_antiflood_points_needed_command_block', Number(v))} />
                <NumField label="Points to Block Connections" value={form.virtualserver_antiflood_points_needed_ip_block} onChange={(v) => set('virtualserver_antiflood_points_needed_ip_block', Number(v))} />
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_antiflood_points_tick_reduce', 'virtualserver_antiflood_points_needed_command_block', 'virtualserver_antiflood_points_needed_ip_block'])} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>

          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Event Logging</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2">
                <LogSwitch label="Clients" checked={Number(form.virtualserver_log_client) === 1} onChange={(v) => set('virtualserver_log_client', v ? 1 : 0)} />
                <LogSwitch label="ServerQuery Clients" checked={Number(form.virtualserver_log_query) === 1} onChange={(v) => set('virtualserver_log_query', v ? 1 : 0)} />
                <LogSwitch label="Channels" checked={Number(form.virtualserver_log_channel) === 1} onChange={(v) => set('virtualserver_log_channel', v ? 1 : 0)} />
                <LogSwitch label="Permissions" checked={Number(form.virtualserver_log_permissions) === 1} onChange={(v) => set('virtualserver_log_permissions', v ? 1 : 0)} />
                <LogSwitch label="Server Changes" checked={Number(form.virtualserver_log_server) === 1} onChange={(v) => set('virtualserver_log_server', v ? 1 : 0)} />
                <LogSwitch label="File Transfers" checked={Number(form.virtualserver_log_filetransfer) === 1} onChange={(v) => set('virtualserver_log_filetransfer', v ? 1 : 0)} />
              </div>
              <Button size="sm" onClick={() => save(['virtualserver_log_client', 'virtualserver_log_query', 'virtualserver_log_channel', 'virtualserver_log_permissions', 'virtualserver_log_server', 'virtualserver_log_filetransfer'])} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limits" className="mt-4 space-y-4">
          <Card className="card-hero">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">File Transfer Limits (per user)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <NumField label="Upload Quota (MB)" hint="0 = unlimited" value={form.virtualserver_upload_quota} onChange={(v) => set('virtualserver_upload_quota', Number(v))} />
                <NumField label="Download Quota (MB)" hint="0 = unlimited" value={form.virtualserver_download_quota} onChange={(v) => set('virtualserver_download_quota', Number(v))} />
                <NumField label="Upload Bandwidth (Bytes/s)" hint="0 = unlimited" value={form.virtualserver_max_upload_total_bandwidth} onChange={(v) => set('virtualserver_max_upload_total_bandwidth', Number(v))} />
                <NumField label="Download Bandwidth (Bytes/s)" hint="0 = unlimited" value={form.virtualserver_max_download_total_bandwidth} onChange={(v) => set('virtualserver_max_download_total_bandwidth', Number(v))} />
              </div>
              <Button size="sm" onClick={() => save(LIMITS_FIELDS)} disabled={editServer.isPending}>Save</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
