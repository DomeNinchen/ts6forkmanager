import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  SUPPORT_PAUSE_NOTES, supportStats, type SupportCaseEntry, type SupportCaseState, type SupportQueueView,
} from '@ts6/common';
import { Headset, Loader2, PauseCircle, Plus, Settings2, UserCheck, UserMinus, CheckCircle2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import i18n from '@/lib/i18n';
import { supportQueueApi } from '@/api/support-queue.api';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { tsErrorMessage } from '@/lib/ts-errors';
import { formatTempDate } from '@/components/temporary-groups/TemporaryGroups';
import { SupportQueueSettingsDialog } from '@/components/support-queue/SupportQueueSettingsDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';

// The queue refreshes every 3 s (the backend looks at TeamSpeak every 5 s); wait times count up every second.
const REFRESH_MS = 3000;

/** "1 h 02 min", "4 min 05 s", "35 s". */
export function formatWait(ms: number, t: TFunction): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return t('pages.support.duration.hours', { h, m: String(m).padStart(2, '0') });
  if (m > 0) return t('pages.support.duration.minutes', { m, s: String(sec).padStart(2, '0') });
  return t('pages.support.duration.seconds', { s: sec });
}

const STATE_VARIANT: Record<SupportCaseState, 'default' | 'warning' | 'success' | 'secondary'> = {
  waiting: 'warning',
  'in-progress': 'default',
  done: 'success',
  cancelled: 'secondary',
};

function StateBadge({ state }: { state: SupportCaseState }) {
  const { t } = useTranslation();
  return <Badge variant={STATE_VARIANT[state]} className="whitespace-nowrap">{t(`pages.support.states.${state}`)}</Badge>;
}

function VipBadge() {
  const { t } = useTranslation();
  return <Badge variant="outline" className="shrink-0 border-amber-500/50 text-amber-400" title={t('pages.support.vipHint')}>{t('pages.support.vip')}</Badge>;
}

function pauseText(reason: string, t: TFunction): string {
  if (reason === SUPPORT_PAUSE_NOTES.connectionInactive) return t('pages.support.paused.connectionInactive');
  if (reason.startsWith(SUPPORT_PAUSE_NOTES.unreachable)) {
    return t('pages.support.paused.unreachable', { detail: reason.slice(SUPPORT_PAUSE_NOTES.unreachable.length + 2) });
  }
  return reason;
}

function errorText(err: any, t: TFunction): string {
  const code = err?.response?.data?.code;
  if (typeof code === 'string' && i18n.exists(`pages.support.errors.${code}`)) {
    // A failed take-over also says what TeamSpeak answered.
    const details = err?.response?.data?.details;
    return t(`pages.support.errors.${code}`) + (code.startsWith('TAKE_FAILED') && details ? ` (${details})` : '');
  }
  return tsErrorMessage(err, t('components.bulkResult.unknownError'), t);
}

/** Ticks every second while mounted, so wait times move between refreshes. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Support() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const isAdmin = useAuthStore((st) => st.isAdmin());
  const canAct = useAuthStore((st) => st.can('clients.move'));
  const now = useNow();
  const [params, setParams] = useSearchParams();
  // null: closed; 'new': adding a queue; a number: that queue's settings.
  const [settingsFor, setSettingsFor] = useState<number | 'new' | null>(null);
  const [taking, setTaking] = useState<SupportCaseEntry | null>(null);
  const [removing, setRemoving] = useState<SupportCaseEntry | null>(null);

  const viewQ = useQuery({ queryKey: ['support-queue', c, s], queryFn: () => supportQueueApi.queues(c!, s!), enabled: !!c && !!s, refetchInterval: REFRESH_MS, staleTime: 0 });
  const queues = viewQ.data ?? [];
  // The tab is kept in the URL (?queue=), so a link or a reload opens the same queue.
  const view = queues.find((q) => String(q.config.id) === params.get('queue')) ?? queues[0];
  const queueId = view?.config.id ?? null;
  const pick = (id: number) => setParams((p) => { p.set('queue', String(id)); return p; }, { replace: true });
  const historyQ = useQuery({ queryKey: ['support-queue-history', c, s, queueId], queryFn: () => supportQueueApi.history(c!, s!, queueId), enabled: !!c && !!s && queueId !== null, refetchInterval: REFRESH_MS * 5, staleTime: 0 });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['support-queue', c, s] });
    qc.invalidateQueries({ queryKey: ['support-queue-history', c, s] });
    qc.invalidateQueries({ queryKey: ['support-queue-stats', c, s] });
  };
  const act = useMutation({
    mutationFn: (a: { kind: 'take'; id: number; clid: number } | { kind: 'remove' | 'close' | 'bringBack'; id: number }) =>
      a.kind === 'take' ? supportQueueApi.take(c!, s!, a.id, a.clid) : supportQueueApi[a.kind](c!, s!, a.id),
    onSuccess: (entry, a) => {
      toast.success(t(`pages.support.toasts.${a.kind}`, { client: entry.nickname }));
      setTaking(null);
      setRemoving(null);
      refresh();
    },
    onError: (err) => {
      toast.error(errorText(err, t));
      refresh();
    },
  });

  if (!c || !s) return <EmptyState icon={Headset} title={t('pages.noServerSelected')} />;
  if (viewQ.isLoading) return <PageLoader />;
  if (viewQ.isError || !viewQ.data) {
    return (
      <EmptyState icon={Headset} title={t('pages.support.loadError')} description={errorText(viewQ.error, t)}>
        <Button variant="outline" onClick={() => viewQ.refetch()}>{t('pages.support.retry')}</Button>
      </EmptyState>
    );
  }

  const status = view?.status;
  const cases = view?.cases ?? [];
  const waiting = cases.filter((k) => k.state === 'waiting');
  const taken = cases.filter((k) => k.state === 'in-progress');
  const history = historyQ.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('nav.items.support')}</h1>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsFor('new')}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />{t('pages.support.addQueue')}
            </Button>
            {view && (
              <Button variant="outline" size="sm" onClick={() => setSettingsFor(view.config.id!)}>
                <Settings2 className="mr-1.5 h-4 w-4" aria-hidden />{t('pages.support.settings.open')}
              </Button>
            )}
          </div>
        )}
      </div>

      {queues.length > 0 && (
        <Tabs value={String(queueId)} onValueChange={(v) => pick(Number(v))}>
          <TabsList aria-label={t('pages.support.queuesLabel')}>
            {queues.map((q) => (
              <TabsTrigger key={q.config.id} value={String(q.config.id)}>
                {q.config.settings.name}
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {q.config.enabled ? `(${q.cases.filter((k) => k.state === 'waiting').length})` : `(${t('pages.support.off')})`}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {!view || !view.config.enabled || !status ? (
        <EmptyState
          icon={Headset}
          title={t(!view ? 'pages.support.notSetUp' : 'pages.support.switchedOff')}
          description={t(isAdmin ? 'pages.support.setUpHintAdmin' : 'pages.support.setUpHint')}
        />
      ) : (
        <>
          {status.paused && (
            <div role="status" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
              <div>
                <p className="font-medium">{t('pages.support.paused.title')}</p>
                <p className="text-muted-foreground">
                  {pauseText(status.paused, t)}
                  {status.pausedSince && ` · ${t('pages.support.paused.since', { time: formatTempDate(status.pausedSince) })}`}
                </p>
              </div>
            </div>
          )}

          {/* While paused nobody knows who is online, so no count at all rather than a wrong 0. */}
          {!status.paused && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="font-medium">{t('pages.support.supportersOnline', { count: status.supporters.length })}</span>
            <span className="flex flex-wrap gap-1.5">
              {status.supporters.map((p) => <Badge key={p.clid} variant="outline">{p.nickname}</Badge>)}
            </span>
            {status.checkedAt && <span className="text-xs text-muted-foreground">{t('pages.support.checkedAt', { time: formatTempDate(status.checkedAt) })}</span>}
          </div>}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('pages.support.waitingTitle', { count: waiting.length })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {waiting.length === 0 && <p className="text-sm text-muted-foreground">{t('pages.support.emptyQueue')}</p>}
              {[...waiting, ...taken].map((k) => (
                <CaseRow key={k.id} entry={k} now={now} canAct={canAct} busy={act.isPending}
                  onTake={() => setTaking(k)} onRemove={() => setRemoving(k)} onClose={() => act.mutate({ kind: 'close', id: k.id })}
                  onBringBack={() => act.mutate({ kind: 'bringBack', id: k.id })} />
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {view && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('pages.support.historyTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('pages.support.emptyHistory')}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {history.map((k) => <HistoryRow key={k.id} entry={k} showActor={canAct} />)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {view && <StatsCard queueId={queueId} queueName={view.config.settings.name} several={queues.length > 1} />}

      {taking && status && (
        <TakeDialog entry={taking} supporters={status.supporters} busy={act.isPending}
          onCancel={() => setTaking(null)} onTake={(clid) => act.mutate({ kind: 'take', id: taking.id, clid })} />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('pages.support.removeTitle')}
        description={t('pages.support.removeDescription', { client: removing?.nickname ?? '' })}
        confirmLabel={t('pages.support.actions.remove')}
        destructive
        loading={act.isPending}
        onConfirm={() => removing && act.mutate({ kind: 'remove', id: removing.id })}
      />
      {isAdmin && settingsFor !== null && (
        <SupportQueueSettingsDialog
          queueId={settingsFor === 'new' ? null : settingsFor}
          onClose={() => setSettingsFor(null)}
          onSaved={(id) => { refresh(); pick(id); }}
          onDeleted={() => { setSettingsFor(null); setParams((p) => { p.delete('queue'); return p; }, { replace: true }); refresh(); }}
        />
      )}
    </div>
  );
}

/** Why a failed take-over left the client where it is (shown on the case and in the history). */
function TakeFailureNote({ entry: k }: { entry: SupportCaseEntry }) {
  const { t } = useTranslation();
  const f = k.takeFailure;
  if (!f) return null;
  return (
    <p className="basis-full text-xs text-amber-400" role="status">
      {t('pages.support.takeFailed', { step: t(`pages.support.takeSteps.${f.step}`), error: f.error })}{' '}
      {f.clientCid === null ? t('pages.support.takeFailedClientOffline') : t('pages.support.takeFailedClientIn', { cid: f.clientCid })}
      {f.roomExists && <> {t('pages.support.takeFailedRoom')}</>}
    </p>
  );
}

function CaseRow({ entry: k, now, canAct, busy, onTake, onRemove, onClose, onBringBack }: {
  entry: SupportCaseEntry; now: number; canAct: boolean; busy: boolean; onTake: () => void; onRemove: () => void; onClose: () => void; onBringBack: () => void;
}) {
  const { t } = useTranslation();
  const since = new Date(k.arrivedAt).getTime();
  const waitEnd = k.takenAt ? new Date(k.takenAt).getTime() : now;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border p-3">
      <span className="w-8 shrink-0 text-center text-lg font-semibold tabular-nums" aria-label={k.position ? t('pages.support.positionLabel', { position: k.position }) : undefined}>
        {k.position ?? '–'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 font-medium"><span className="truncate">{k.nickname}</span>{k.vip && <VipBadge />}</p>
        <p className="text-xs text-muted-foreground">
          <span title={k.arrivalUnknown ? t('pages.support.arrivalUnknownHint') : formatTempDate(k.arrivedAt)}>
            {t(k.arrivalUnknown ? 'pages.support.waitedAtLeast' : 'pages.support.waited', { time: formatWait(waitEnd - since, t) })}
          </span>
          {k.absentSince && <span className="ml-2 text-amber-400">{t('pages.support.absent', { time: formatWait(now - new Date(k.absentSince).getTime(), t) })}</span>}
          {k.takenBy.length > 0 && <span className="ml-2">{t(k.takenVia === 'web' ? 'pages.support.takenByWeb' : 'pages.support.takenBy', { names: k.takenBy.map((p) => p.nickname).join(', ') })}</span>}
        </p>
      </div>
      <StateBadge state={k.state} />
      {canAct && (
        <div className="flex flex-wrap gap-2">
          {k.state === 'waiting' ? (
            <>
              {k.takeFailure && (
                <Button size="sm" variant="secondary" onClick={onBringBack} disabled={busy}><Undo2 className="mr-1.5 h-4 w-4" aria-hidden />{t('pages.support.actions.bringBack')}</Button>
              )}
              <Button size="sm" onClick={onTake} disabled={busy}><UserCheck className="mr-1.5 h-4 w-4" aria-hidden />{t('pages.support.actions.take')}</Button>
              <Button size="sm" variant="outline" onClick={onRemove} disabled={busy}><UserMinus className="mr-1.5 h-4 w-4" aria-hidden />{t('pages.support.actions.remove')}</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}><CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden />{t('pages.support.actions.close')}</Button>
          )}
        </div>
      )}
      <TakeFailureNote entry={k} />
    </div>
  );
}

// Which web user acted is shown only to those who may act themselves, not to read-only viewers.
function HistoryRow({ entry: k, showActor }: { entry: SupportCaseEntry; showActor: boolean }) {
  const { t } = useTranslation();
  const arrived = new Date(k.arrivedAt).getTime();
  const waitedUntil = new Date(k.takenAt ?? k.endedAt ?? k.arrivedAt).getTime();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="flex min-w-0 basis-full items-center gap-2 font-medium sm:basis-auto sm:flex-1"><span className="truncate">{k.nickname}</span>{k.vip && <VipBadge />}</span>
      <span className="text-xs text-muted-foreground">{formatTempDate(k.arrivedAt)}</span>
      <span className="text-xs tabular-nums">{t(k.arrivalUnknown ? 'pages.support.historyWaitedAtLeast' : 'pages.support.historyWaited', { time: formatWait(waitedUntil - arrived, t) })}</span>
      {k.takenBy.length > 0 && <span className="text-xs text-muted-foreground">{k.takenBy.map((p) => p.nickname).join(', ')}</span>}
      <StateBadge state={k.state} />
      {k.endReason && <span className="text-xs text-muted-foreground">{t(`pages.support.endReasons.${k.endReason}`)}{showActor && k.actedBy ? ` (${k.actedBy})` : ''}</span>}
      <TakeFailureNote entry={k} />
    </li>
  );
}

function TakeDialog({ entry, supporters, busy, onCancel, onTake }: {
  entry: SupportCaseEntry; supporters: SupportQueueView['status']['supporters']; busy: boolean; onCancel: () => void; onTake: (clid: number) => void;
}) {
  const { t } = useTranslation();
  const [clid, setClid] = useState<string>(supporters.length === 1 ? String(supporters[0].clid) : '');
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.support.takeTitle', { client: entry.nickname })}</DialogTitle>
          <DialogDescription>{t('pages.support.takeDescription')}</DialogDescription>
        </DialogHeader>
        {supporters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('pages.support.noSupporterOnline')}</p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="support-take-supporter">{t('pages.support.supporter')}</Label>
            <Select value={clid} onValueChange={setClid}>
              <SelectTrigger id="support-take-supporter"><SelectValue placeholder={t('pages.support.chooseSupporter')} /></SelectTrigger>
              <SelectContent>
                {supporters.map((p) => <SelectItem key={p.clid} value={String(p.clid)}>{p.nickname}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button onClick={() => onTake(Number(clid))} disabled={!clid || busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}{t('pages.support.actions.take')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PERIODS = [7, 30, 90] as const;

/** Day label in the viewer's own time zone; sv-SE writes YYYY-MM-DD, which also sorts. */
const localDay = (ms: number) => new Date(ms).toLocaleDateString('sv-SE');

/** Figures over the cases that ended in the chosen period, computed here from the history. */
function StatsCard({ queueId, queueName, several }: { queueId: number | null; queueName: string; several: boolean }) {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  // With several queues: this tab's queue, or every queue of the virtual server together.
  const [all, setAll] = useState(false);
  const scope = several && all ? null : queueId;
  const q = useQuery({ queryKey: ['support-queue-stats', c, s, scope, days], queryFn: () => supportQueueApi.ended(c!, s!, scope, days), enabled: !!c && !!s, refetchInterval: 60_000, staleTime: 0 });
  const st = q.data ? supportStats(q.data, days, localDay) : null;
  const wait = (ms: number | null) => (ms === null ? '–' : formatWait(ms, t));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">{t('pages.support.stats.title')}</CardTitle>
        <div className="flex flex-wrap gap-2">
        {several && (
          <Select value={all ? 'all' : 'queue'} onValueChange={(v) => setAll(v === 'all')}>
            <SelectTrigger className="w-44" aria-label={t('pages.support.stats.scope')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="queue">{queueName}</SelectItem>
              <SelectItem value="all">{t('pages.support.stats.allQueues')}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as (typeof PERIODS)[number])}>
          <SelectTrigger className="w-40" aria-label={t('pages.support.stats.period')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map((d) => <SelectItem key={d} value={String(d)}>{t('pages.support.stats.lastDays', { count: d })}</SelectItem>)}
          </SelectContent>
        </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isError && <p className="text-sm text-destructive">{errorText(q.error, t)}</p>}
        {st && st.cases === 0 && <p className="text-sm text-muted-foreground">{t('pages.support.stats.empty')}</p>}
        {st && st.cases > 0 && (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {([
                ['cases', st.cases], ['taken', st.taken], ['cancelled', st.cancelled], ['avgWait', wait(st.avgWaitMs)], ['maxWait', wait(st.maxWaitMs)],
                // Only when the period has VIP cases: their wait next to everyone else's.
                ...(st.vipAvgWaitMs !== null || st.otherAvgWaitMs !== null ? [['vipAvgWait', wait(st.vipAvgWaitMs)], ['otherAvgWait', wait(st.otherAvgWaitMs)]] as const : []),
              ] as const).map(([k, v]) => (
                <div key={k} className="rounded-md border border-border p-2">
                  <dt className="text-xs text-muted-foreground">{t(`pages.support.stats.${k}`)}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-4 md:grid-cols-2">
              <table className="w-full text-sm">
                <caption className="pb-1 text-left text-xs font-medium text-muted-foreground">{t('pages.support.stats.perSupporter')}</caption>
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="font-normal">{t('pages.support.supporter')}</th><th className="pl-2 text-right font-normal">{t('pages.support.stats.cases')}</th><th className="pl-2 text-right font-normal">{t('pages.support.stats.perDay')}</th></tr></thead>
                <tbody>
                  {st.perSupporter.length === 0 && <tr><td colSpan={3} className="text-muted-foreground">–</td></tr>}
                  {st.perSupporter.map((p) => (
                    <tr key={p.uid} className="border-t border-border"><td className="max-w-[10rem] truncate py-1">{p.nickname}</td><td className="pl-2 text-right tabular-nums">{p.cases}</td><td className="pl-2 text-right tabular-nums">{p.perDay.toLocaleString(i18n.language)}</td></tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full text-sm">
                <caption className="pb-1 text-left text-xs font-medium text-muted-foreground">{t('pages.support.stats.perDayTitle')}</caption>
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="font-normal">{t('pages.support.stats.day')}</th><th className="pl-2 text-right font-normal">{t('pages.support.stats.cases')}</th><th className="pl-2 text-right font-normal">{t('pages.support.stats.taken')}</th><th className="pl-2 text-right font-normal">{t('pages.support.stats.cancelled')}</th><th className="pl-2 text-right font-normal">{t('pages.support.stats.avgWait')}</th></tr></thead>
                <tbody>
                  {st.perDay.map((d) => (
                    <tr key={d.day} className="border-t border-border"><td className="py-1">{new Date(`${d.day}T12:00:00`).toLocaleDateString(i18n.language, { dateStyle: 'medium' })}</td><td className="pl-2 text-right tabular-nums">{d.cases}</td><td className="pl-2 text-right tabular-nums">{d.taken}</td><td className="pl-2 text-right tabular-nums">{d.cancelled}</td><td className="pl-2 text-right tabular-nums">{wait(d.avgWaitMs)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{t('pages.support.stats.note')}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
