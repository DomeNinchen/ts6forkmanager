import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  RAID_ACTIONS, RAID_LIMITS, RAID_PRESET_RULES, RAID_PRESETS, RAID_RETENTION_DEFAULT_DAYS, RAID_RETENTION_MAX_DAYS, RAID_RETENTION_MIN_DAYS, RAID_RULE_KINDS,
  raidPresetOf, raidSettingsProblem, type RaidAction, type RaidNotifyMode, type RaidProtectionConfig, type RaidRuleKind, type RaidSettings,
} from '@ts6/common';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { raidProtectionApi } from '@/api/raid-protection.api';
import { settingsApi } from '@/api/settings.api';
import { useServerStore } from '@/stores/server.store';
import { useServerGroups } from '@/hooks/use-groups';
import { tsErrorMessage } from '@/lib/ts-errors';
import { formatTempDate } from '@/components/temporary-groups/TemporaryGroups';
import { IdPicker, NumberRow, SwitchRow, TextRow, type Option } from '@/components/support-queue/SupportQueueSettingsDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const POKE_MAX = 100;

/** Raid protection of the selected virtual server (admins only). */
export function RaidSettingsDialog({ config, onClose, onSaved }: { config: RaidProtectionConfig; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const { data: groups } = useServerGroups();
  const [enabled, setEnabled] = useState(config.enabled);
  const [settings, setSettings] = useState<RaidSettings>(config.settings);
  const [saving, setSaving] = useState(false);
  // How long closed incidents are kept: one value for every virtual server.
  const retentionQ = useQuery({ queryKey: ['raid-retention'], queryFn: () => settingsApi.raidRetention(), staleTime: 0 });
  const [retention, setRetention] = useState<number | null>(null);
  useEffect(() => { if (retentionQ.data && retention === null) setRetention(retentionQ.data.retentionDays); }, [retentionQ.data, retention]);
  const retentionProblem = retention !== null && !(Number.isInteger(retention) && retention >= RAID_RETENTION_MIN_DAYS && retention <= RAID_RETENTION_MAX_DAYS)
    ? t('pages.raid.settings.retentionRange', { min: RAID_RETENTION_MIN_DAYS, max: RAID_RETENTION_MAX_DAYS }) : null;

  // Only regular groups (type 1) can hold clients.
  const groupOptions: Option[] = (Array.isArray(groups) ? groups : []).filter((g: any) => String(g.type) === '1').map((g: any) => ({ id: Number(g.sgid), name: String(g.name) }));
  const set = <K extends keyof RaidSettings>(k: K, v: RaidSettings[K]) => setSettings((cur) => ({ ...cur, [k]: v }));
  const setRule = (kind: RaidRuleKind, patch: Record<string, number | boolean>) =>
    setSettings((cur) => ({ ...cur, rules: { ...cur.rules, [kind]: { ...cur.rules[kind], ...patch } } }));
  const preset = raidPresetOf(settings.rules);
  // Only the fields of actions some enabled rule uses are shown.
  const used = new Set(RAID_RULE_KINDS.filter((k) => settings.rules[k].enabled).map((k) => settings.actions[k]));
  const problem = raidSettingsProblem(settings);
  const noNotifyGroup = settings.notify !== 'off' && settings.notifyGroupIds.length === 0 ? t('pages.raid.settings.needNotifyGroup') : null;

  const save = async () => {
    setSaving(true);
    try {
      await raidProtectionApi.save(c!, s!, { enabled, settings });
      if (retention !== null && retention !== retentionQ.data?.retentionDays) await settingsApi.setRaidRetention(retention);
      toast.success(t('pages.raid.settings.saved'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(tsErrorMessage(err, t('components.bulkResult.unknownError'), t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('pages.raid.settings.title')}</DialogTitle>
          <DialogDescription>{t('pages.raid.settings.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <SwitchRow id="raid-enabled" label={t('pages.raid.settings.enabled')} hint={t('pages.raid.settings.enabledHint')} checked={enabled} onChange={setEnabled} />

          <fieldset className="space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-semibold">{t('pages.raid.settings.rulesTitle')}</legend>
            <div className="space-y-1.5">
              <Label htmlFor="raid-preset">{t('pages.raid.settings.preset')}</Label>
              <Select value={preset ?? 'custom'} onValueChange={(v) => v !== 'custom' && set('rules', structuredClone(RAID_PRESET_RULES[v as keyof typeof RAID_PRESET_RULES]))}>
                <SelectTrigger id="raid-preset"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RAID_PRESETS.map((p) => <SelectItem key={p} value={p}>{t(`pages.raid.presets.${p}`)}</SelectItem>)}
                  <SelectItem value="custom" disabled>{t('pages.raid.presets.custom')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('pages.raid.settings.presetHint')}</p>
            </div>
            {RAID_RULE_KINDS.map((kind) => {
              const r = settings.rules[kind];
              return (
                <div key={kind} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor={`raid-rule-${kind}`}>{t(`pages.raid.rules.${kind}`)}</Label>
                      <p className="text-xs text-muted-foreground">{t(`pages.raid.rules.${kind}Hint`)}</p>
                    </div>
                    <Switch id={`raid-rule-${kind}`} checked={r.enabled} onCheckedChange={(v) => setRule(kind, { enabled: v })} />
                  </div>
                  {r.enabled && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor={`raid-${kind}-count`} className="text-xs">{t('pages.raid.settings.count')}</Label>
                        <Input id={`raid-${kind}-count`} type="number" min={RAID_LIMITS.count[0]} max={RAID_LIMITS.count[1]} value={r.count} onChange={(e) => setRule(kind, { count: Number(e.target.value) })} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`raid-${kind}-window`} className="text-xs">{t('pages.raid.settings.windowSec')}</Label>
                        <Input id={`raid-${kind}-window`} type="number" min={RAID_LIMITS.windowSec[0]} max={RAID_LIMITS.windowSec[1]} value={r.windowSec} onChange={(e) => setRule(kind, { windowSec: Number(e.target.value) })} />
                      </div>
                      {kind === 'new' && (
                        <div className="space-y-1">
                          <Label htmlFor="raid-new-share" className="text-xs">{t('pages.raid.settings.sharePct')}</Label>
                          <Input id="raid-new-share" type="number" min={1} max={100} value={settings.rules.new.sharePct} onChange={(e) => setRule('new', { sharePct: Number(e.target.value) })} />
                        </div>
                      )}
                      <div className="col-span-2 space-y-1 sm:col-span-3">
                        <Label htmlFor={`raid-${kind}-action`} className="text-xs">{t('pages.raid.settings.action')}</Label>
                        <Select value={settings.actions[kind]} onValueChange={(v) => set('actions', { ...settings.actions, [kind]: v as RaidAction })}>
                          <SelectTrigger id={`raid-${kind}-action`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {RAID_ACTIONS.map((a) => <SelectItem key={a} value={a}>{t(`pages.raid.actions.${a}`)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>

          <fieldset className="space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-semibold">{t('pages.raid.settings.actionsTitle')}</legend>
            <p className="text-xs text-muted-foreground">{t('pages.raid.settings.actionsHint')}</p>
            {used.has('warn') && (
              <TextRow id="raid-warn-text" label={t('pages.raid.settings.warnText')} hint="{server}" max={RAID_LIMITS.warnTextMax} value={settings.warnText} onChange={(v) => set('warnText', v)} />
            )}
            {used.has('restrict') && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="raid-restrict-group">{t('pages.raid.settings.restrictGroup')}</Label>
                  <Select value={settings.restrictGroupId ? String(settings.restrictGroupId) : ''} onValueChange={(v) => set('restrictGroupId', Number(v))}>
                    <SelectTrigger id="raid-restrict-group"><SelectValue placeholder={t('pages.raid.settings.chooseGroup')} /></SelectTrigger>
                    <SelectContent>
                      {groupOptions.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t('pages.raid.settings.restrictGroupHint')}</p>
                </div>
                <NumberRow id="raid-restrict-min" label={t('pages.raid.settings.restrictMinutes')} min={RAID_LIMITS.restrictMinutes[0]} max={RAID_LIMITS.restrictMinutes[1]} value={settings.restrictMinutes} onChange={(v) => set('restrictMinutes', v)} />
              </>
            )}
            {used.has('kick') && (
              <div className="space-y-1.5">
                <Label htmlFor="raid-kick-reason">{t('pages.raid.settings.kickReason')}</Label>
                <Input id="raid-kick-reason" maxLength={RAID_LIMITS.kickReasonMax} value={settings.kickReason} onChange={(e) => set('kickReason', e.target.value)} />
                <p className="text-xs text-muted-foreground">{t('pages.raid.settings.kickReasonHint', { max: RAID_LIMITS.kickReasonMax })}</p>
              </div>
            )}
            {used.has('ban') && (
              <>
                <NumberRow id="raid-ban-min" label={t('pages.raid.settings.banMinutes')} hint={t('pages.raid.settings.banMinutesHint')} min={RAID_LIMITS.banMinutes[0]} max={RAID_LIMITS.banMinutes[1]} value={settings.banMinutes} onChange={(v) => set('banMinutes', v)} />
                <div className="space-y-1.5">
                  <Label htmlFor="raid-ban-reason">{t('pages.raid.settings.banReason')}</Label>
                  <Input id="raid-ban-reason" maxLength={RAID_LIMITS.banReasonMax} value={settings.banReason} onChange={(e) => set('banReason', e.target.value)} />
                </div>
                <SwitchRow id="raid-ban-ip" label={t('pages.raid.settings.banIp')} hint={t('pages.raid.settings.banIpHint')} checked={settings.banIp} onChange={(v) => set('banIp', v)} />
                {settings.banIp && (
                  <div role="alert" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                    <p>{t('pages.raid.settings.banIpWarning')}</p>
                  </div>
                )}
              </>
            )}
            <NumberRow id="raid-max-actions" label={t('pages.raid.settings.maxActionsPerMin')} hint={t('pages.raid.settings.maxActionsPerMinHint')} min={RAID_LIMITS.maxActionsPerMin[0]} max={RAID_LIMITS.maxActionsPerMin[1]} value={settings.maxActionsPerMin} onChange={(v) => set('maxActionsPerMin', v)} />
          </fieldset>

          <fieldset className="space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-semibold">{t('pages.raid.settings.exemptTitle')}</legend>
            <IdPicker legend={t('pages.raid.settings.exemptGroups')} hint={t('pages.raid.settings.exemptGroupsHint')} options={groupOptions} value={settings.exemptGroupIds} onChange={(v) => set('exemptGroupIds', v)} />
            <NumberRow id="raid-known" label={t('pages.raid.settings.knownSessions')} hint={t('pages.raid.settings.knownSessionsHint')} min={RAID_LIMITS.knownSessions[0]} max={RAID_LIMITS.knownSessions[1]} value={settings.knownSessions} onChange={(v) => set('knownSessions', v)} />
            <NumberRow id="raid-grace" label={t('pages.raid.settings.graceMin')} hint={t('pages.raid.settings.graceMinHint')} min={RAID_LIMITS.graceMin[0]} max={RAID_LIMITS.graceMin[1]} value={settings.graceMin} onChange={(v) => set('graceMin', v)} />
            <NumberRow
              id="raid-observe"
              label={t('pages.raid.settings.observeDays')}
              hint={config.observeUntil ? t('pages.raid.settings.observeDaysSet', { date: formatTempDate(config.observeUntil) }) : t('pages.raid.settings.observeDaysHint')}
              min={RAID_LIMITS.observeDays[0]} max={RAID_LIMITS.observeDays[1]} value={settings.observeDays} onChange={(v) => set('observeDays', v)}
            />
          </fieldset>

          <fieldset className="space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-semibold">{t('pages.raid.settings.notifyTitle')}</legend>
            <div className="space-y-1.5">
              <Label htmlFor="raid-notify">{t('pages.raid.settings.notify')}</Label>
              <Select value={settings.notify} onValueChange={(v) => set('notify', v as RaidNotifyMode)}>
                <SelectTrigger id="raid-notify"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['off', 'poke', 'message'] as const).map((m) => <SelectItem key={m} value={m}>{t(`pages.raid.notifyModes.${m}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {settings.notify !== 'off' && (
              <>
                <IdPicker legend={t('pages.raid.settings.notifyGroups')} hint={t('pages.raid.settings.notifyGroupsHint')} options={groupOptions} value={settings.notifyGroupIds} onChange={(v) => set('notifyGroupIds', v)} />
                <TextRow
                  id="raid-notify-text" label={t('pages.raid.settings.notifyText')}
                  hint={`{server} {rules} {clients}${settings.notify === 'poke' ? ` · ${t('pages.raid.settings.pokeMax', { max: POKE_MAX })}` : ''}`}
                  max={RAID_LIMITS.notifyTextMax} value={settings.notifyText} onChange={(v) => set('notifyText', v)}
                />
              </>
            )}
          </fieldset>

          <fieldset className="space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-semibold">{t('pages.raid.settings.historyTitle')}</legend>
            <NumberRow id="raid-retention" label={t('pages.raid.settings.retention')} hint={t('pages.raid.settings.retentionHint')} min={RAID_RETENTION_MIN_DAYS} max={RAID_RETENTION_MAX_DAYS} value={retention ?? RAID_RETENTION_DEFAULT_DAYS} onChange={setRetention} />
          </fieldset>

          {(problem || noNotifyGroup || retentionProblem) && <p role="alert" className="text-sm text-destructive">{noNotifyGroup ?? problem ?? retentionProblem}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={save} disabled={!!problem || !!noNotifyGroup || !!retentionProblem || saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
