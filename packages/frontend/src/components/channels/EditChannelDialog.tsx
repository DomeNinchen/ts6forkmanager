import { useEffect, useState } from 'react';
import { channelsApi } from '@/api/channels.api';
import { useEditChannel } from '@/hooks/use-channels';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type ChannelType = 'permanent' | 'semipermanent' | 'temporary';
type ClientsMode = 'limited' | 'unlimited';
type FamilyClientsMode = 'limited' | 'unlimited' | 'inherited';

interface EditChannelForm {
  channel_name: string;
  channel_topic: string;
  channel_description: string;
  channel_password: string;
  channel_codec: string;
  channel_codec_quality: string;
  encrypted: boolean;
  clientsMode: ClientsMode;
  channel_maxclients: string;
  familyClientsMode: FamilyClientsMode;
  channel_maxfamilyclients: string;
  channel_needed_talk_power: string;
  type: ChannelType;
  channel_delete_delay: string;
  channel_flag_default: boolean;
  channel_order: string;
  channel_name_phonetic: string;
  channel_banner_gfx_url: string;
  channel_banner_mode: string;
}

const EMPTY_FORM: EditChannelForm = {
  channel_name: '',
  channel_topic: '',
  channel_description: '',
  channel_password: '',
  channel_codec: '4',
  channel_codec_quality: '7',
  encrypted: true,
  clientsMode: 'unlimited',
  channel_maxclients: '10',
  familyClientsMode: 'inherited',
  channel_maxfamilyclients: '10',
  channel_needed_talk_power: '0',
  type: 'permanent',
  channel_delete_delay: '0',
  channel_flag_default: false,
  channel_order: '0',
  channel_name_phonetic: '',
  channel_banner_gfx_url: '',
  channel_banner_mode: '0',
};

const num = (v: any, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const flag = (v: any) => num(v) === 1;

function formFromChannelInfo(info: any, fallbackName: string): EditChannelForm {
  const type: ChannelType = flag(info.channel_flag_permanent)
    ? 'permanent'
    : flag(info.channel_flag_semi_permanent)
      ? 'semipermanent'
      : 'temporary';
  const familyClientsMode: FamilyClientsMode = flag(info.channel_flag_maxfamilyclients_inherited)
    ? 'inherited'
    : flag(info.channel_flag_maxfamilyclients_unlimited)
      ? 'unlimited'
      : 'limited';
  const clientsMode: ClientsMode = flag(info.channel_flag_maxclients_unlimited) ? 'unlimited' : 'limited';

  return {
    channel_name: info.channel_name ?? fallbackName,
    channel_topic: info.channel_topic ?? '',
    channel_description: info.channel_description ?? '',
    channel_password: '',
    channel_codec: String(info.channel_codec ?? '4'),
    channel_codec_quality: String(num(info.channel_codec_quality, 7)),
    encrypted: !flag(info.channel_codec_is_unencrypted),
    clientsMode,
    channel_maxclients: String(clientsMode === 'unlimited' ? 10 : num(info.channel_maxclients, 10)),
    familyClientsMode,
    channel_maxfamilyclients: String(familyClientsMode === 'limited' ? num(info.channel_maxfamilyclients, 10) : 10),
    channel_needed_talk_power: String(num(info.channel_needed_talk_power, 0)),
    type,
    channel_delete_delay: String(num(info.channel_delete_delay, 0)),
    channel_flag_default: flag(info.channel_flag_default),
    channel_order: String(num(info.channel_order, 0)),
    channel_name_phonetic: info.channel_name_phonetic ?? '',
    channel_banner_gfx_url: info.channel_banner_gfx_url ?? '',
    channel_banner_mode: String(num(info.channel_banner_mode, 0)),
  };
}

function buildPayload(form: EditChannelForm): Record<string, any> {
  const data: Record<string, any> = {
    channel_name: form.channel_name,
    channel_topic: form.channel_topic,
    channel_description: form.channel_description,
    channel_codec: num(form.channel_codec, 4),
    channel_codec_quality: num(form.channel_codec_quality, 7),
    channel_codec_is_unencrypted: form.encrypted ? 0 : 1,
    channel_needed_talk_power: num(form.channel_needed_talk_power, 0),
    channel_order: num(form.channel_order, 0),
    channel_name_phonetic: form.channel_name_phonetic,
    channel_banner_gfx_url: form.channel_banner_gfx_url,
    channel_banner_mode: num(form.channel_banner_mode, 0),
    channel_flag_default: form.channel_flag_default ? 1 : 0,
    channel_flag_permanent: form.type === 'permanent' ? 1 : 0,
    channel_flag_semi_permanent: form.type === 'semipermanent' ? 1 : 0,
  };

  if (form.channel_password) data.channel_password = form.channel_password;

  if (form.type === 'temporary') {
    data.channel_delete_delay = num(form.channel_delete_delay, 0);
  }

  if (form.clientsMode === 'unlimited') {
    data.channel_flag_maxclients_unlimited = 1;
  } else {
    data.channel_flag_maxclients_unlimited = 0;
    data.channel_maxclients = num(form.channel_maxclients, 0);
  }

  if (form.familyClientsMode === 'inherited') {
    data.channel_flag_maxfamilyclients_inherited = 1;
    data.channel_flag_maxfamilyclients_unlimited = 0;
  } else if (form.familyClientsMode === 'unlimited') {
    data.channel_flag_maxfamilyclients_inherited = 0;
    data.channel_flag_maxfamilyclients_unlimited = 1;
  } else {
    data.channel_flag_maxfamilyclients_inherited = 0;
    data.channel_flag_maxfamilyclients_unlimited = 0;
    data.channel_maxfamilyclients = num(form.channel_maxfamilyclients, 0);
  }

  return data;
}

interface EditChannelDialogProps {
  cid: number | null;
  fallbackName: string;
  onClose: () => void;
}

export function EditChannelDialog({ cid, fallbackName, onClose }: EditChannelDialogProps) {
  const { selectedConfigId, selectedSid } = useServerStore();
  const editChannel = useEditChannel();
  const [form, setForm] = useState<EditChannelForm>(EMPTY_FORM);
  const [originalName, setOriginalName] = useState(fallbackName);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (cid === null || !selectedConfigId || !selectedSid) return;
    setLoaded(false);
    setLoadError(null);
    setForm({ ...EMPTY_FORM, channel_name: fallbackName });
    setOriginalName(fallbackName);

    let cancelled = false;
    channelsApi.get(selectedConfigId, selectedSid, cid).then((res) => {
      if (cancelled) return;
      const info = Array.isArray(res) ? res[0] : res;
      const nextForm = formFromChannelInfo(info || {}, fallbackName);
      setForm(nextForm);
      setOriginalName(nextForm.channel_name);
      setLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      setLoadError('Failed to load full channel settings');
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, selectedConfigId, selectedSid]);

  const handleSave = () => {
    if (cid === null || !form.channel_name.trim()) return;
    const data = buildPayload(form);
    // TS6's channeledit rejects channel_name when it's unchanged from the
    // channel's own current name, treating it as a conflict with itself
    // (error 771 "channel name is already in use") - confirmed live against
    // a real server. Only send it when it actually changed.
    if (form.channel_name === originalName) delete data.channel_name;
    editChannel.mutate({ cid, data }, {
      onSuccess: () => { toast.success('Channel updated'); onClose(); },
      onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to update channel'),
    });
  };

  return (
    <Dialog open={cid !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Channel</DialogTitle>
        </DialogHeader>

        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        {!loaded && !loadError && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading full channel settings...
          </div>
        )}

        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="limits">Limits &amp; Type</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <div className="overflow-y-auto flex-1 mt-1 pr-1">
            <TabsContent value="general" className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">Channel Name</Label>
                <Input value={form.channel_name} onChange={(e) => setForm({ ...form, channel_name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Topic</Label>
                <Input value={form.channel_topic} onChange={(e) => setForm({ ...form, channel_topic: e.target.value })} placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea value={form.channel_description} onChange={(e) => setForm({ ...form, channel_description: e.target.value })} placeholder="Optional" rows={3} />
              </div>
              <div>
                <Label className="text-xs">Password</Label>
                <Input type="password" value={form.channel_password} onChange={(e) => setForm({ ...form, channel_password: e.target.value })} placeholder="Leave empty to keep current" />
              </div>
            </TabsContent>

            <TabsContent value="voice" className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">Codec</Label>
                <Select value={form.channel_codec} onValueChange={(v) => setForm({ ...form, channel_codec: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">Opus Voice</SelectItem>
                    <SelectItem value="5">Opus Music</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Codec Quality ({form.channel_codec_quality})</Label>
                <Input type="number" min={0} max={10} value={form.channel_codec_quality} onChange={(e) => setForm({ ...form, channel_codec_quality: e.target.value })} />
                <p className="text-[11px] text-muted-foreground mt-0.5">0 = lowest, 10 = highest. Higher quality uses more bandwidth.</p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.encrypted} onCheckedChange={(v) => setForm({ ...form, encrypted: v })} />
                <Label className="text-xs">Encrypt voice data in this channel</Label>
              </div>
            </TabsContent>

            <TabsContent value="limits" className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={form.type} onValueChange={(v: ChannelType) => setForm({ ...form, type: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">Permanent</SelectItem>
                    <SelectItem value="semipermanent">Semi-Permanent</SelectItem>
                    <SelectItem value="temporary">Temporary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.type === 'temporary' && (
                <div>
                  <Label className="text-xs">Delete Delay (seconds when empty)</Label>
                  <Input type="number" min={0} value={form.channel_delete_delay} onChange={(e) => setForm({ ...form, channel_delete_delay: e.target.value })} />
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.channel_flag_default} onCheckedChange={(v) => setForm({ ...form, channel_flag_default: v })} />
                <Label className="text-xs">Default channel</Label>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                A server has only one default channel — enabling this removes the flag from whichever channel currently has it.
              </p>

              <div>
                <Label className="text-xs">Max Clients</Label>
                <div className="flex items-center gap-2">
                  <Select value={form.clientsMode} onValueChange={(v: ClientsMode) => setForm({ ...form, clientsMode: v })}>
                    <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="limited">Limited</SelectItem>
                      <SelectItem value="unlimited">Unlimited</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.clientsMode === 'limited' && (
                    <Input type="number" min={0} className="flex-1" value={form.channel_maxclients} onChange={(e) => setForm({ ...form, channel_maxclients: e.target.value })} />
                  )}
                </div>
              </div>

              <div>
                <Label className="text-xs">Max Family Clients</Label>
                <div className="flex items-center gap-2">
                  <Select value={form.familyClientsMode} onValueChange={(v: FamilyClientsMode) => setForm({ ...form, familyClientsMode: v })}>
                    <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherited">Inherited</SelectItem>
                      <SelectItem value="limited">Limited</SelectItem>
                      <SelectItem value="unlimited">Unlimited</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.familyClientsMode === 'limited' && (
                    <Input type="number" min={0} className="flex-1" value={form.channel_maxfamilyclients} onChange={(e) => setForm({ ...form, channel_maxfamilyclients: e.target.value })} />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">Limits clients across this channel and all its sub-channels combined.</p>
              </div>

              <div>
                <Label className="text-xs">Needed Talk Power</Label>
                <Input type="number" min={0} value={form.channel_needed_talk_power} onChange={(e) => setForm({ ...form, channel_needed_talk_power: e.target.value })} />
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">Sort Position</Label>
                <Input type="number" min={0} value={form.channel_order} onChange={(e) => setForm({ ...form, channel_order: e.target.value })} />
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  The channel ID this one should be positioned directly below among its siblings (0 = first). Channel IDs are shown as "#id" in the channel tree.
                </p>
              </div>
              <div>
                <Label className="text-xs">Phonetic Name</Label>
                <Input value={form.channel_name_phonetic} onChange={(e) => setForm({ ...form, channel_name_phonetic: e.target.value })} placeholder="How text-to-speech should pronounce this channel's name" />
              </div>
              <div>
                <Label className="text-xs">Banner Image URL</Label>
                <Input value={form.channel_banner_gfx_url} onChange={(e) => setForm({ ...form, channel_banner_gfx_url: e.target.value })} placeholder="Optional" />
              </div>
              {form.channel_banner_gfx_url && (
                <div>
                  <Label className="text-xs">Banner Mode</Label>
                  <Select value={form.channel_banner_mode} onValueChange={(v) => setForm({ ...form, channel_banner_mode: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Don't adjust</SelectItem>
                      <SelectItem value="1">Adjust, ignore aspect ratio</SelectItem>
                      <SelectItem value="2">Adjust, keep aspect ratio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.channel_name.trim() || !loaded || editChannel.isPending}>
            {editChannel.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
