import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { normalizeIconId } from '@ts6/common';
import { channelsApi } from '@/api/channels.api';
import { permissionsApi } from '@/api/permissions.api';
import { useEditChannel } from '@/hooks/use-channels';
import { useServerStore } from '@/stores/server.store';
import { channelIconErrorMessage } from '@/lib/ts-errors';
import { IconImage } from '@/components/icons/IconImage';
import { IconPickerDialog } from '@/components/icons/IconPickerDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Image as ImageIcon, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

type ChannelType = 'permanent' | 'semipermanent' | 'temporary';
type ClientsMode = 'limited' | 'unlimited';
type FamilyClientsMode = 'limited' | 'unlimited' | 'inherited';

interface EditChannelForm {
  channel_name: string;
  /** The channel's icon (a CRC32 icon ID, 0 = none). Not a `channeledit` property: TS6 rejects
   * `channel_icon_id` there, the icon is the channel permission `i_icon_id` - see handleSave. */
  iconId: number;
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
  iconId: 0,
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
    // channelinfo reports the icon the channel's i_icon_id permission yields, as an unsigned
    // CRC32; normalizeIconId also copes with the signed form some other commands use
    iconId: normalizeIconId(info.channel_icon_id),
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
  const { t } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const editChannel = useEditChannel();
  const [form, setForm] = useState<EditChannelForm>(EMPTY_FORM);
  const [originalName, setOriginalName] = useState(fallbackName);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const qc = useQueryClient();
  // The icon as the server has it - to tell whether it was changed, and what was saved already
  const [originalIconId, setOriginalIconId] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingIcon, setSavingIcon] = useState(false);

  useEffect(() => {
    if (cid === null || !selectedConfigId || !selectedSid) return;
    setLoaded(false);
    setLoadError(null);
    setForm({ ...EMPTY_FORM, channel_name: fallbackName });
    setOriginalName(fallbackName);
    setOriginalIconId(0);
    setPickerOpen(false);

    let cancelled = false;
    channelsApi.get(selectedConfigId, selectedSid, cid).then((res) => {
      if (cancelled) return;
      const info = Array.isArray(res) ? res[0] : res;
      const nextForm = formFromChannelInfo(info || {}, fallbackName);
      setForm(nextForm);
      setOriginalName(nextForm.channel_name);
      setOriginalIconId(nextForm.iconId);
      setLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      setLoadError(t('components.editChannelDialog.loadFailed'));
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, selectedConfigId, selectedSid]);

  const handleSave = async () => {
    if (cid === null || !selectedConfigId || !selectedSid || !form.channel_name.trim()) return;
    const data = buildPayload(form);
    // TS6's channeledit rejects channel_name when it's unchanged from the
    // channel's own current name, treating it as a conflict with itself
    // (error 771 "channel name is already in use") - confirmed live against
    // a real server. Only send it when it actually changed.
    if (form.channel_name === originalName) delete data.channel_name;

    // 1. The channel's own settings. When this fails nothing has been changed yet.
    try {
      await editChannel.mutateAsync({ cid, data });
    } catch (err: any) {
      toast.error(err?.response?.data?.details || err?.response?.data?.error || t('components.editChannelDialog.updateFailed'));
      return;
    }
    // The server has the new name now; a second Save (after the icon failed below) must not send it again
    setOriginalName(form.channel_name);

    // 2. The icon, only when it was changed. It is the channel permission i_icon_id and not a
    // channeledit property - TS6 (6.0.0-beta13.1) answers `1538 invalid parameter` to
    // channel_icon_id on every path (WebQuery, SSH ServerQuery, the client protocol), whatever
    // the value - so it is a request of its own that can fail on its own, typically for a
    // missing right, which is why the message says what is missing. The permission is set with
    // channeladdperm and removed with channeldelperm (a value of 0 would leave an empty entry
    // behind); the channel's icon follows at once, and its sub-channels do not inherit it.
    if (form.iconId !== originalIconId) {
      setSavingIcon(true);
      try {
        if (form.iconId > 0) {
          await permissionsApi.addChannelPerm(selectedConfigId, selectedSid, cid, { permsid: 'i_icon_id', permvalue: form.iconId });
        } else {
          await permissionsApi.delChannelPerm(selectedConfigId, selectedSid, cid, { permsid: 'i_icon_id' });
        }
      } catch (err: any) {
        // The dialog stays open and the icon stays selected, so it can be tried again
        toast.error(t('components.editChannelDialog.iconSaveFailed', { reason: channelIconErrorMessage(err, t) }));
        return;
      } finally {
        setSavingIcon(false);
      }
      setOriginalIconId(form.iconId);
      // Everything that shows the channel's permissions or where an icon is used
      for (const key of ['entity-perms', 'perm-find', 'perm-overview', 'icon-usage']) {
        qc.invalidateQueries({ queryKey: [key, selectedConfigId, selectedSid] });
      }
    }

    toast.success(t('components.editChannelDialog.updated'));
    onClose();
  };

  return (
    <Dialog open={cid !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('components.editChannelDialog.title')}</DialogTitle>
        </DialogHeader>

        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        {!loaded && !loadError && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('components.editChannelDialog.loadingSettings')}
          </div>
        )}

        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="general">{t('components.editChannelDialog.tabs.general')}</TabsTrigger>
            <TabsTrigger value="voice">{t('components.editChannelDialog.tabs.voice')}</TabsTrigger>
            <TabsTrigger value="limits">{t('components.editChannelDialog.tabs.limits')}</TabsTrigger>
            <TabsTrigger value="advanced">{t('components.editChannelDialog.tabs.advanced')}</TabsTrigger>
          </TabsList>

          <div className="overflow-y-auto flex-1 mt-1 pr-1">
            <TabsContent value="general" className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">{t('components.editChannelDialog.channelName')}</Label>
                <Input value={form.channel_name} onChange={(e) => setForm({ ...form, channel_name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">{t('components.editChannelDialog.icon')}</Label>
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
                      form.iconId > 0 ? 'border-border bg-muted/30' : 'border-dashed border-border/60 text-muted-foreground/50',
                    )}
                  >
                    {form.iconId > 0 ? <IconImage iconId={form.iconId} size={24} /> : <ImageIcon className="h-4 w-4" />}
                  </div>
                  <span className={cn('min-w-0 flex-1 truncate text-xs', form.iconId > 0 ? 'font-mono-data' : 'text-muted-foreground')}>
                    {form.iconId > 0 ? `#${form.iconId}` : t('components.editChannelDialog.iconNone')}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={!loaded}>
                    <ImageIcon className="h-3.5 w-3.5 mr-1" /> {t('components.editChannelDialog.iconChoose')}
                  </Button>
                  {form.iconId > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setForm({ ...form, iconId: 0 })}
                      title={t('components.editChannelDialog.iconRemove')}
                      aria-label={t('components.editChannelDialog.iconRemove')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t('components.editChannelDialog.iconHint')}</p>
              </div>
              <div>
                <Label className="text-xs">{t('components.editChannelDialog.topic')}</Label>
                <Input value={form.channel_topic} onChange={(e) => setForm({ ...form, channel_topic: e.target.value })} placeholder={t('common.optional')} />
              </div>
              <div>
                <Label className="text-xs">{t('common.description')}</Label>
                <Textarea value={form.channel_description} onChange={(e) => setForm({ ...form, channel_description: e.target.value })} placeholder={t('common.optional')} rows={3} />
              </div>
              <div>
                <Label className="text-xs">{t('common.password')}</Label>
                <Input type="password" value={form.channel_password} onChange={(e) => setForm({ ...form, channel_password: e.target.value })} placeholder={t('components.editChannelDialog.leaveEmptyToKeep')} />
              </div>
            </TabsContent>

            <TabsContent value="voice" className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">{t('components.editChannelDialog.codec')}</Label>
                <Select value={form.channel_codec} onValueChange={(v) => setForm({ ...form, channel_codec: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">Opus Voice</SelectItem>
                    <SelectItem value="5">Opus Music</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t('components.editChannelDialog.codecQuality', { quality: form.channel_codec_quality })}</Label>
                <Input type="number" min={0} max={10} value={form.channel_codec_quality} onChange={(e) => setForm({ ...form, channel_codec_quality: e.target.value })} />
                <p className="text-[11px] text-muted-foreground mt-0.5">{t('components.editChannelDialog.codecQualityHint')}</p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.encrypted} onCheckedChange={(v) => setForm({ ...form, encrypted: v })} />
                <Label className="text-xs">{t('components.editChannelDialog.encryptVoice')}</Label>
              </div>
            </TabsContent>

            <TabsContent value="limits" className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">{t('common.type')}</Label>
                <Select value={form.type} onValueChange={(v: ChannelType) => setForm({ ...form, type: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="permanent">{t('components.editChannelDialog.type.permanent')}</SelectItem>
                    <SelectItem value="semipermanent">{t('components.editChannelDialog.type.semipermanent')}</SelectItem>
                    <SelectItem value="temporary">{t('components.editChannelDialog.type.temporary')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.type === 'temporary' && (
                <div>
                  <Label className="text-xs">{t('components.editChannelDialog.deleteDelay')}</Label>
                  <Input type="number" min={0} value={form.channel_delete_delay} onChange={(e) => setForm({ ...form, channel_delete_delay: e.target.value })} />
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.channel_flag_default} onCheckedChange={(v) => setForm({ ...form, channel_flag_default: v })} />
                <Label className="text-xs">{t('components.editChannelDialog.defaultChannel')}</Label>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                {t('components.editChannelDialog.defaultChannelHint')}
              </p>

              <div>
                <Label className="text-xs">{t('components.editChannelDialog.maxClients')}</Label>
                <div className="flex items-center gap-2">
                  <Select value={form.clientsMode} onValueChange={(v: ClientsMode) => setForm({ ...form, clientsMode: v })}>
                    <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="limited">{t('components.editChannelDialog.limited')}</SelectItem>
                      <SelectItem value="unlimited">{t('components.editChannelDialog.unlimited')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.clientsMode === 'limited' && (
                    <Input type="number" min={0} className="flex-1" value={form.channel_maxclients} onChange={(e) => setForm({ ...form, channel_maxclients: e.target.value })} />
                  )}
                </div>
              </div>

              <div>
                <Label className="text-xs">{t('components.editChannelDialog.maxFamilyClients')}</Label>
                <div className="flex items-center gap-2">
                  <Select value={form.familyClientsMode} onValueChange={(v: FamilyClientsMode) => setForm({ ...form, familyClientsMode: v })}>
                    <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherited">{t('components.editChannelDialog.inherited')}</SelectItem>
                      <SelectItem value="limited">{t('components.editChannelDialog.limited')}</SelectItem>
                      <SelectItem value="unlimited">{t('components.editChannelDialog.unlimited')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.familyClientsMode === 'limited' && (
                    <Input type="number" min={0} className="flex-1" value={form.channel_maxfamilyclients} onChange={(e) => setForm({ ...form, channel_maxfamilyclients: e.target.value })} />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t('components.editChannelDialog.maxFamilyClientsHint')}</p>
              </div>

              <div>
                <Label className="text-xs">{t('components.editChannelDialog.neededTalkPower')}</Label>
                <Input type="number" min={0} value={form.channel_needed_talk_power} onChange={(e) => setForm({ ...form, channel_needed_talk_power: e.target.value })} />
              </div>
            </TabsContent>

            <TabsContent value="advanced" className="space-y-3 mt-2">
              <div>
                <Label className="text-xs">{t('components.editChannelDialog.sortPosition')}</Label>
                <Input type="number" min={0} value={form.channel_order} onChange={(e) => setForm({ ...form, channel_order: e.target.value })} />
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t('components.editChannelDialog.sortPositionHint')}
                </p>
              </div>
              <div>
                <Label className="text-xs">{t('components.editChannelDialog.phoneticName')}</Label>
                <Input value={form.channel_name_phonetic} onChange={(e) => setForm({ ...form, channel_name_phonetic: e.target.value })} placeholder={t('components.editChannelDialog.phoneticNamePlaceholder')} />
              </div>
              <div>
                <Label className="text-xs">{t('components.editChannelDialog.bannerImageUrl')}</Label>
                <Input value={form.channel_banner_gfx_url} onChange={(e) => setForm({ ...form, channel_banner_gfx_url: e.target.value })} placeholder={t('common.optional')} />
              </div>
              {form.channel_banner_gfx_url && (
                <div>
                  <Label className="text-xs">{t('components.editChannelDialog.bannerMode')}</Label>
                  <Select value={form.channel_banner_mode} onValueChange={(v) => setForm({ ...form, channel_banner_mode: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">{t('components.editChannelDialog.bannerMode0')}</SelectItem>
                      <SelectItem value="1">{t('components.editChannelDialog.bannerMode1')}</SelectItem>
                      <SelectItem value="2">{t('components.editChannelDialog.bannerMode2')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={!form.channel_name.trim() || !loaded || editChannel.isPending || savingIcon}>
            {editChannel.isPending || savingIcon ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>

        {/* Inside the dialog's own tree, so that Radix treats clicks and Escape in the picker as
            belonging to the topmost layer and does not close this dialog underneath it. */}
        <IconPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          currentIconId={form.iconId}
          idEntryAvailable={false}
          onSelect={(iconId) => setForm((current) => ({ ...current, iconId }))}
        />
      </DialogContent>
    </Dialog>
  );
}
