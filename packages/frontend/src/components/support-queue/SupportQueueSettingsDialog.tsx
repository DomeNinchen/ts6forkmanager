import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { SUPPORT_GRACE_MAX_SEC, SUPPORT_ROOM_NAME_MAX, supportSettingsProblem, type SupportQueueSettings, type SupportRoomType } from '@ts6/common';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supportQueueApi } from '@/api/support-queue.api';
import { useServerStore } from '@/stores/server.store';
import { useChannels } from '@/hooks/use-channels';
import { useServerGroups } from '@/hooks/use-groups';
import { tsErrorMessage } from '@/lib/ts-errors';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';

interface Option { id: number; name: string }

/** A list of checkboxes for picking several ids (supporter groups, AFK channels). */
function IdPicker({ legend, options, value, onChange }: { legend: string; options: Option[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
        {options.map((o) => {
          const id = `${legend}-${o.id}`;
          return (
            <div key={o.id} className="flex items-center gap-2">
              <Checkbox id={id} checked={value.includes(o.id)} onCheckedChange={(on) => onChange(on ? [...value, o.id] : value.filter((v) => v !== o.id))} />
              <Label htmlFor={id} className="font-normal">{o.name}</Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SupportQueueSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const configQ = useQuery({ queryKey: ['support-queue-config', c, s], queryFn: () => supportQueueApi.config(c!, s!), enabled: !!c && !!s, staleTime: 0 });
  const { data: channels } = useChannels();
  const { data: groups } = useServerGroups();
  const [enabled, setEnabled] = useState(true);
  const [channelId, setChannelId] = useState(0);
  const [settings, setSettings] = useState<SupportQueueSettings | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ flowId: number; name: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!configQ.data || settings) return;
    const { config, conflicts: found } = configQ.data;
    setEnabled(config.id === null ? true : config.enabled);
    setChannelId(config.channelId);
    setSettings(config.settings);
    setConflicts(found);
  }, [configQ.data, settings]);

  const channelOptions: Option[] = (Array.isArray(channels) ? channels : []).map((ch: any) => ({ id: Number(ch.cid), name: String(ch.channel_name) }));
  // Only regular groups (type 1) can hold clients.
  const groupOptions: Option[] = (Array.isArray(groups) ? groups : []).filter((g: any) => String(g.type) === '1').map((g: any) => ({ id: Number(g.sgid), name: String(g.name) }));
  const set = <K extends keyof SupportQueueSettings>(k: K, v: SupportQueueSettings[K]) => setSettings((cur) => (cur ? { ...cur, [k]: v } : cur));

  const problem = settings ? supportSettingsProblem(settings) : null;
  const missing = !channelId ? t('pages.support.settings.needChannel') : settings && settings.supporterGroupIds.length === 0 ? t('pages.support.settings.needGroup') : null;

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await supportQueueApi.saveConfig(c!, s!, { enabled, channelId, settings });
      setConflicts(res.conflicts);
      toast.success(t('pages.support.settings.saved'));
      onSaved();
      if (res.conflicts.length === 0) onClose();
    } catch (err) {
      toast.error(tsErrorMessage(err, t('components.bulkResult.unknownError'), t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pages.support.settings.title')}</DialogTitle>
          <DialogDescription>{t('pages.support.settings.description')}</DialogDescription>
        </DialogHeader>
        {!settings ? <PageLoader /> : (
          <div className="space-y-4">
            {conflicts.length > 0 && (
              <div role="alert" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                <div>
                  <p className="font-medium">{t('pages.support.settings.conflictTitle')}</p>
                  <p className="text-muted-foreground">{t('pages.support.settings.conflictText', { flows: conflicts.map((f) => f.name).join(', ') })}</p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="sq-enabled">{t('pages.support.settings.enabled')}</Label>
              <Switch id="sq-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sq-channel">{t('pages.support.settings.channel')}</Label>
              <Select value={channelId ? String(channelId) : ''} onValueChange={(v) => setChannelId(Number(v))}>
                <SelectTrigger id="sq-channel"><SelectValue placeholder={t('pages.support.settings.chooseChannel')} /></SelectTrigger>
                <SelectContent>
                  {channelOptions.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('pages.support.settings.channelHint')}</p>
            </div>
            <IdPicker legend={t('pages.support.settings.groups')} options={groupOptions} value={settings.supporterGroupIds} onChange={(v) => set('supporterGroupIds', v)} />
            <IdPicker legend={t('pages.support.settings.afk')} options={channelOptions.filter((o) => o.id !== channelId)} value={settings.afkChannelIds} onChange={(v) => set('afkChannelIds', v)} />
            <div className="space-y-1.5">
              <Label htmlFor="sq-grace">{t('pages.support.settings.grace')}</Label>
              <Input id="sq-grace" type="number" min={0} max={SUPPORT_GRACE_MAX_SEC} value={settings.graceSec} onChange={(e) => set('graceSec', Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">{t('pages.support.settings.graceHint')}</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="sq-without">{t('pages.support.settings.withoutSupporter')}</Label>
                <p className="text-xs text-muted-foreground">{t('pages.support.settings.withoutSupporterHint')}</p>
              </div>
              <Switch id="sq-without" checked={settings.queueWithoutSupporter} onCheckedChange={(v) => set('queueWithoutSupporter', v)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sq-room">{t('pages.support.settings.roomName')}</Label>
              <Input id="sq-room" maxLength={SUPPORT_ROOM_NAME_MAX} value={settings.roomName} onChange={(e) => set('roomName', e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('pages.support.settings.roomNameHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sq-roomtype">{t('pages.support.settings.roomType')}</Label>
              <Select value={settings.roomType} onValueChange={(v) => set('roomType', v as SupportRoomType)}>
                <SelectTrigger id="sq-roomtype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['temporary', 'semipermanent', 'permanent'] as const).map((r) => <SelectItem key={r} value={r}>{t(`pages.support.settings.roomTypes.${r}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(problem || missing) && <p role="alert" className="text-sm text-destructive">{missing ?? problem}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={!settings || !!problem || !!missing || saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
