import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TEMP_GROUP_PLACEHOLDERS, TEMP_GROUP_TEXT_MAX, isValidTimeZone, noticeSettingsProblem, renderNoticeText,
  type TempGroupNoticeRecord, type TempGroupNoticeSettings,
} from '@ts6/common';
import { Bell, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { groupsApi } from '@/api/groups.api';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatTempDate, tempGroupErrorMessage } from './TemporaryGroups';

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** "7d, 1d, 12h" -> ms (whole minutes), or null when a part cannot be read. */
export function parseWarnTimes(text: string): number[] | null {
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  const out: number[] = [];
  for (const part of parts) {
    const m = /^(\d+(?:[.,]\d+)?)\s*([mhd])$/i.exec(part);
    if (!m) return null;
    out.push(Math.round((Number(m[1].replace(',', '.')) * UNIT_MS[m[2].toLowerCase() as keyof typeof UNIT_MS]) / 60_000) * 60_000);
  }
  return out;
}

/** ms -> "7d" / "12h" / "30m", the largest unit that fits exactly. */
export function formatWarnTime(ms: number): string {
  if (ms % UNIT_MS.d === 0) return `${ms / UNIT_MS.d}d`;
  if (ms % UNIT_MS.h === 0) return `${ms / UNIT_MS.h}h`;
  return `${Math.round(ms / UNIT_MS.m)}m`;
}

/** The last notice of an entry, for the list: what, when, which ways, and whether it still waits. */
export function NoticeLine({ notice, pending }: { notice: TempGroupNoticeRecord | null; pending: string | null }) {
  const { t } = useTranslation();
  if (!notice) return null;
  const what = notice.kind === 'warning'
    ? t('pages.temporaryGroups.notice.warning', { before: notice.beforeMs ? formatWarnTime(notice.beforeMs) : '' })
    : t('pages.temporaryGroups.notice.expired');
  const ways = notice.sent.map((c) => t(`pages.temporaryGroups.notice.channels.${c}`)).join(', ') || t('pages.temporaryGroups.notice.nothingSent');
  return (
    <div className="text-xs text-muted-foreground mt-1 max-w-[280px]" data-testid="temp-notice-line">
      <Bell className="inline h-3 w-3 mr-1" />
      {what} {formatTempDate(notice.at)}: {ways}
      {pending && notice.waitingForOnline && <> · {t('pages.temporaryGroups.notice.waiting')}</>}
      {notice.error && <div className="text-destructive">{notice.error}</div>}
    </div>
  );
}

/** Admin only: when and how clients of this virtual server hear about their deadline. */
export function NoticeSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['temporary-group-notices', c, s],
    queryFn: () => groupsApi.temporaryGroupNoticeSettings(c!, s!),
    enabled: !!c && !!s && open,
  });
  const [draft, setDraft] = useState<TempGroupNoticeSettings | null>(null);
  const [warnText, setWarnText] = useState('');
  useEffect(() => {
    if (data) { setDraft(data.settings); setWarnText(data.settings.warnBeforeMs.map(formatWarnTime).join(', ')); }
  }, [data]);
  const save = useMutation({
    mutationFn: (settings: TempGroupNoticeSettings) => groupsApi.setTemporaryGroupNoticeSettings(c!, s!, settings),
    onSuccess: () => { toast.success(t('pages.temporaryGroups.notices.saved')); qc.invalidateQueries({ queryKey: ['temporary-group-notices', c, s] }); },
    onError: (err) => toast.error(tempGroupErrorMessage(err, t)),
  });

  const parsedWarn = parseWarnTimes(warnText);
  const candidate = draft && parsedWarn ? { ...draft, warnBeforeMs: parsedWarn } : null;
  // The same checks as the backend, worded for the reader.
  const problem = !parsedWarn ? t('pages.temporaryGroups.notices.warnTimesInvalid')
    : !candidate || !noticeSettingsProblem(candidate) ? null
    : !isValidTimeZone(candidate.timeZone) ? t('pages.temporaryGroups.notices.timeZoneInvalid')
    : !candidate.warningText.trim() || !candidate.expiredText.trim() ? t('pages.temporaryGroups.notices.textEmpty')
    : t('pages.temporaryGroups.notices.warnTimesRange');
  const set = (patch: Partial<TempGroupNoticeSettings>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const now = Date.now();
  const preview = (text: string) => draft ? renderNoticeText(text, { client: 'Anna', group: 'VIP', expiresAt: now + 86_400_000, now, timeZone: draft.timeZone }) : '';

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Bell className="h-4 w-4" /> {t('pages.temporaryGroups.notices.title')}
      </button>
      {open && (!draft ? <div className="p-3"><Loader2 className="h-4 w-4 animate-spin" /></div> : (
        <div className="space-y-3 border-t border-border p-3 text-sm">
          <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.notices.intro')}</p>
          <label className="flex items-center gap-2">
            <Switch checked={draft.enabled} onCheckedChange={(v) => set({ enabled: v })} />
            {t('pages.temporaryGroups.notices.enabled')}
          </label>
          <div className="space-y-1">
            <Label htmlFor="temp-notice-warn" className="text-xs">{t('pages.temporaryGroups.notices.warnTimes')}</Label>
            <Input id="temp-notice-warn" className="h-8 max-w-xs" value={warnText} onChange={(e) => setWarnText(e.target.value)} aria-invalid={!parsedWarn} />
            <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.notices.warnTimesHint')}</p>
          </div>
          <label className="flex items-center gap-2">
            <Switch checked={draft.notifyExpired} onCheckedChange={(v) => set({ notifyExpired: v })} />
            {t('pages.temporaryGroups.notices.notifyExpired')}
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium">{t('pages.temporaryGroups.notices.channelsTitle')}</legend>
            {(['privateMessage', 'offlineMessage', 'poke'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <Switch checked={draft[k]} onCheckedChange={(v) => set({ [k]: v })} />
                {t(`pages.temporaryGroups.notices.channels.${k}`)}
              </label>
            ))}
            <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.notices.channelsHint')}</p>
          </fieldset>
          {(['warningText', 'expiredText'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`temp-notice-${k}`} className="text-xs">{t(`pages.temporaryGroups.notices.${k}`)}</Label>
              <Textarea id={`temp-notice-${k}`} rows={2} maxLength={TEMP_GROUP_TEXT_MAX} value={draft[k]} onChange={(e) => set({ [k]: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.notices.preview')}: {preview(draft[k])}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            {t('pages.temporaryGroups.notices.placeholders')}: {TEMP_GROUP_PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}
          </p>
          <div className="space-y-1">
            <Label htmlFor="temp-notice-zone" className="text-xs">{t('pages.temporaryGroups.notices.timeZone')}</Label>
            <Input id="temp-notice-zone" className="h-8 max-w-xs" value={draft.timeZone} onChange={(e) => set({ timeZone: e.target.value.trim() })} />
            <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.notices.timeZoneHint')}</p>
          </div>
          {problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!candidate || !!problem || save.isPending} onClick={() => candidate && save.mutate(candidate)}>{t('common.save')}</Button>
            <Button size="sm" variant="outline" onClick={() => data && (setDraft(data.defaults), setWarnText(data.defaults.warnBeforeMs.map(formatWarnTime).join(', ')))}>
              {t('pages.temporaryGroups.notices.defaults')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
