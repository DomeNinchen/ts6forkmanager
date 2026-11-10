import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { RAID_NOTICE_NOTES, type RaidHit, type RaidIncidentEntry, type RaidProtectionStatus } from '@ts6/common';
import { AlertTriangle, ChevronDown, ChevronRight, Eye, PauseCircle, Settings2, ShieldAlert } from 'lucide-react';
import { raidProtectionApi } from '@/api/raid-protection.api';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { tsErrorMessage } from '@/lib/ts-errors';
import { formatTempDate } from '@/components/temporary-groups/TemporaryGroups';
import { RaidSettingsDialog } from '@/components/raid-protection/RaidSettingsDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';

// The backend judges joins as they come; the page looks every 5 s (incidents every 10 s).
const REFRESH_MS = 5000;

/** One fired rule in words: "12 joins in 60 s", "5 from 203.0.113.0/24", "6 named like raider". */
export function hitText(h: RaidHit, t: TFunction): string {
  return t(`pages.raid.hits.${h.rule}`, { count: h.count, window: h.windowSec, key: h.key ?? t('pages.raid.hidden') });
}

const DETECTION_VARIANT: Record<RaidProtectionStatus['detection'], 'success' | 'warning' | 'destructive'> = {
  live: 'success',
  delayed: 'warning',
  'journal-off': 'destructive',
  unreachable: 'destructive',
};

export default function RaidProtection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const isAdmin = useAuthStore((st) => st.isAdmin());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const viewQ = useQuery({ queryKey: ['raid-protection', c, s], queryFn: () => raidProtectionApi.view(c!, s!), enabled: !!c && !!s, refetchInterval: REFRESH_MS, staleTime: 0 });
  const incidentsQ = useQuery({ queryKey: ['raid-incidents', c, s], queryFn: () => raidProtectionApi.incidents(c!, s!), enabled: !!c && !!s, refetchInterval: REFRESH_MS * 2, staleTime: 0 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['raid-protection', c, s] });
    qc.invalidateQueries({ queryKey: ['raid-incidents', c, s] });
  };

  if (!c || !s) return <EmptyState icon={ShieldAlert} title={t('pages.noServerSelected')} />;
  if (viewQ.isLoading) return <PageLoader />;
  if (viewQ.isError || !viewQ.data) {
    return (
      <EmptyState icon={ShieldAlert} title={t('pages.raid.loadError')} description={tsErrorMessage(viewQ.error, t('components.bulkResult.unknownError'), t)}>
        <Button variant="outline" onClick={() => viewQ.refetch()}>{t('pages.raid.retry')}</Button>
      </EmptyState>
    );
  }

  const { config, status } = viewQ.data;
  const incidents = incidentsQ.data ?? [];
  const observing = config.observeUntil !== null && new Date(config.observeUntil).getTime() > Date.now();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('nav.items.raidProtection')}</h1>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="mr-1.5 h-4 w-4" aria-hidden />{t('pages.raid.settings.open')}
          </Button>
        )}
      </div>

      {!config.enabled ? (
        <EmptyState icon={ShieldAlert} title={t('pages.raid.off')} description={t(isAdmin ? 'pages.raid.offHintAdmin' : 'pages.raid.offHint')} />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('pages.raid.statusTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={DETECTION_VARIANT[status.detection]}>{t(`pages.raid.detection.${status.detection}`)}</Badge>
              <Badge variant="outline" className="gap-1"><Eye className="h-3.5 w-3.5" aria-hidden />{t('pages.raid.observeOnly')}</Badge>
              {status.openIncidentId !== null && <Badge variant="destructive">{t('pages.raid.openIncident', { id: status.openIncidentId })}</Badge>}
            </div>
            <p className="text-muted-foreground">{t(`pages.raid.detectionHint.${status.detection}`)}</p>
            {status.detection === 'journal-off' && (
              <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <p>{t('pages.raid.journalOff')}</p>
              </div>
            )}
            {status.pausedUntil && status.pauseReason && (
              <div role="status" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                <p>{t(`pages.raid.paused.${status.pauseReason}`, { time: formatTempDate(status.pausedUntil) })}</p>
              </div>
            )}
            <p className="text-muted-foreground">
              {observing ? t('pages.raid.observeUntil', { date: formatTempDate(config.observeUntil!) }) : t('pages.raid.stageNote')}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('pages.raid.incidentsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {incidentsQ.isError && <p className="text-sm text-destructive">{tsErrorMessage(incidentsQ.error, t('components.bulkResult.unknownError'), t)}</p>}
          {incidents.length === 0 && !incidentsQ.isError ? (
            <p className="text-sm text-muted-foreground">{t('pages.raid.noIncidents')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {incidents.map((i) => <IncidentRow key={i.id} incident={i} />)}
            </ul>
          )}
        </CardContent>
      </Card>

      {isAdmin && settingsOpen && <RaidSettingsDialog config={config} onClose={() => setSettingsOpen(false)} onSaved={refresh} />}
    </div>
  );
}

function IncidentRow({ incident: i }: { incident: RaidIncidentEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = `raid-incident-${i.id}`;
  const showIp = i.clients.some((c) => c.ip !== null);
  return (
    <li className="py-2">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-1 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="font-medium tabular-nums">#{i.id}</span>
        <span className="text-xs text-muted-foreground">{formatTempDate(i.startedAt)}</span>
        <Badge variant={i.state === 'open' ? 'destructive' : 'secondary'}>{t(`pages.raid.states.${i.state}`)}</Badge>
        <span className="text-sm">{t('pages.raid.clientCount', { count: i.clientCount })}</span>
        <span className="basis-full text-sm text-muted-foreground sm:basis-auto sm:flex-1">{i.hits.map((h) => hitText(h, t)).join(' · ')}</span>
      </button>
      {open && (
        <div id={panelId} className="mt-2 space-y-2 pl-6 text-sm">
          <p className="text-muted-foreground">
            {t('pages.raid.lastHit', { time: formatTempDate(i.lastHitAt) })}
            {i.endedAt && ` · ${t('pages.raid.ended', { time: formatTempDate(i.endedAt) })}`}
            {' · '}{t('pages.raid.nothingDone')}
          </p>
          <p className="text-muted-foreground">{noticeText(i, t)}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <caption className="sr-only">{t('pages.raid.clientsCaption', { id: i.id })}</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="font-normal">{t('pages.raid.columns.nickname')}</th>
                  <th className="pl-2 font-normal">{t('pages.raid.columns.joined')}</th>
                  {showIp && <th className="pl-2 font-normal">{t('pages.raid.columns.ip')}</th>}
                  <th className="pl-2 font-normal">{t('pages.raid.columns.country')}</th>
                  <th className="pl-2 font-normal">{t('pages.raid.columns.identity')}</th>
                </tr>
              </thead>
              <tbody>
                {i.clients.map((cl) => (
                  <tr key={`${cl.uid}|${cl.joinedAt}`} className="border-t border-border">
                    <td className="max-w-[12rem] truncate py-1" title={cl.uid}>{cl.nickname}</td>
                    <td className="pl-2 tabular-nums">{new Date(cl.joinedAt).toLocaleTimeString()}</td>
                    {showIp && <td className="pl-2 tabular-nums">{cl.ip ?? '–'}</td>}
                    <td className="pl-2">{cl.country || '–'}</td>
                    <td className="pl-2">{cl.isNew ? t('pages.raid.newIdentity') : t('pages.raid.seenBefore')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {i.clientCount > i.clients.length && <p className="text-xs text-muted-foreground">{t('pages.raid.moreClients', { count: i.clientCount - i.clients.length })}</p>}
        </div>
      )}
    </li>
  );
}

/** A notice's note in the viewer's language when it is one of the fixed ones; a TeamSpeak error stays as it came. */
function noteText(note: string | null, t: TFunction): string {
  if (!note) return '';
  if (note === RAID_NOTICE_NOTES.nobodyOnline) return t('pages.raid.notice.notes.nobodyOnline');
  if (note.startsWith(RAID_NOTICE_NOTES.noClientList)) return t('pages.raid.notice.notes.noClientList', { detail: note.slice(RAID_NOTICE_NOTES.noClientList.length + 2) });
  return note;
}

function noticeText(i: RaidIncidentEntry, t: TFunction): string {
  if (!i.notice) return t('pages.raid.notice.none');
  const n = i.notice;
  if (n.sent === 0 && n.failed === 0) return t('pages.raid.notice.nobody', { note: noteText(n.note, t) });
  return t(`pages.raid.notice.${n.mode}`, { sent: n.sent }) + (n.failed ? ` · ${t('pages.raid.notice.failed', { count: n.failed, note: noteText(n.note, t) })}` : '');
}
