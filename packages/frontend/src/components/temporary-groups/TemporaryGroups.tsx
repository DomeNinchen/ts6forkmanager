import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '@/api/settings.api';
import { useAuthStore } from '@/stores/auth.store';
import { NoticeLine, NoticeSettingsCard } from './NoticeSettings';
import type { TFunction } from 'i18next';
import {
  TEMP_GROUP_MIN_DURATION_MS, isOpenTempGroupState, parseTempGroupNote, tempGroupDurationProblem, tempGroupExpiry, tempGroupExtendedExpiry,
  type TempGroupState, type TemporaryGroupEntry,
} from '@ts6/common';
import { Clock, Infinity as InfinityIcon, Loader2, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import i18n from '@/lib/i18n';
import { groupsApi, type TempGroupDeadline } from '@/api/groups.api';
import { useTemporaryGroupAction, useTemporaryGroups } from '@/hooks/use-groups';
import { tsErrorMessage } from '@/lib/ts-errors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';

// ---- formatting -------------------------------------------------------------

/** A moment in the viewer's own time zone and language. */
export function formatTempDate(value: string | number): string {
  return new Date(value).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "3 d 4 h", "5 h 20 min", "12 min"; "overdue" once it has passed. */
export function formatRemaining(ms: number, t: TFunction): string {
  if (ms <= 0) return t('pages.temporaryGroups.remaining.overdue');
  const minutes = Math.ceil(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return t('pages.temporaryGroups.remaining.days', { days, hours });
  if (hours > 0) return t('pages.temporaryGroups.remaining.hours', { hours, minutes: minutes % 60 });
  return t('pages.temporaryGroups.remaining.minutes', { minutes });
}

const STATE_VARIANT: Record<TempGroupState, 'default' | 'warning' | 'destructive' | 'secondary' | 'success'> = {
  active: 'default',
  waiting: 'warning',
  error: 'destructive',
  revoked: 'secondary',
  'already-removed': 'secondary',
  permanent: 'success',
};

export function TempStateBadge({ state }: { state: TempGroupState }) {
  const { t } = useTranslation();
  return <Badge variant={STATE_VARIANT[state]} className="whitespace-nowrap">{t(`pages.temporaryGroups.states.${state}`)}</Badge>;
}

/** A stored reason in the viewer's language; anything unknown as it was stored. */
export function tempNoteText(text: string, t: TFunction): string {
  const note = parseTempGroupNote(text);
  return note ? t(`pages.temporaryGroups.notes.${note.key}`, { detail: note.detail }) : text;
}

/** The manager's own refusals by code; everything else as TeamSpeak or the backend put it. */
export function tempGroupErrorMessage(err: any, t: TFunction): string {
  const code = err?.response?.data?.code;
  if (typeof code === 'string' && i18n.exists(`pages.temporaryGroups.errors.${code}`)) return t(`pages.temporaryGroups.errors.${code}`);
  return tsErrorMessage(err, t('components.bulkResult.unknownError'), t);
}

// ---- the deadline input -----------------------------------------------------

type Unit = 'minutes' | 'hours' | 'days';
const UNIT_MS: Record<Unit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export interface DeadlineInput {
  /** "for" a duration, or "until" a date - two separate inputs, so a duration is never turned into calendar days. */
  mode: 'for' | 'until';
  amount: string;
  unit: Unit;
  /** `<input type="datetime-local">` value, the viewer's local time. */
  until: string;
}

export const DEFAULT_DEADLINE: DeadlineInput = { mode: 'for', amount: '30', unit: 'days', until: '' };

/** The duration the "for" fields describe, or NaN. */
function durationOf(input: DeadlineInput): number {
  const amount = Number(input.amount.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * UNIT_MS[input.unit]) : NaN;
}

/** What the inputs mean right now: the body for the backend and the resulting expiry, or the span from now that is not allowed. */
export function resolveDeadline(input: DeadlineInput, now: number): { body: TempGroupDeadline; expiresAt: number } | { problem: number } {
  if (input.mode === 'for') {
    const durationMs = durationOf(input);
    return tempGroupDurationProblem(durationMs) ? { problem: durationMs } : { body: { durationMs }, expiresAt: tempGroupExpiry(now, durationMs) };
  }
  const at = input.until ? new Date(input.until).getTime() : NaN;
  return tempGroupDurationProblem(at - now) ? { problem: at - now } : { body: { expiresAt: new Date(at).toISOString() }, expiresAt: at };
}

/** Why a span (ms from now) is not allowed - the same bounds the backend checks. */
function problemText(spanMs: number, t: TFunction): string {
  if (!Number.isFinite(spanMs)) return t('pages.temporaryGroups.deadline.invalid');
  if (spanMs < TEMP_GROUP_MIN_DURATION_MS) return t('pages.temporaryGroups.deadline.tooShort');
  return t('pages.temporaryGroups.deadline.tooLong');
}

/** The value a datetime-local input needs for a moment, in the viewer's time zone. */
function localInputValue(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function DeadlineFields({ value, onChange, forLabel }: { value: DeadlineInput; onChange: (v: DeadlineInput) => void; forLabel?: string }) {
  const { t } = useTranslation();
  const set = (patch: Partial<DeadlineInput>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <div className="flex gap-1" role="radiogroup" aria-label={t('pages.temporaryGroups.deadline.mode')}>
        {(['for', 'until'] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            size="sm"
            role="radio"
            aria-checked={value.mode === mode}
            variant={value.mode === mode ? 'default' : 'outline'}
            onClick={() => set({ mode, until: value.until || localInputValue(Date.now() + UNIT_MS.days * 30) })}
          >
            {mode === 'for' ? (forLabel ?? t('pages.temporaryGroups.deadline.for')) : t('pages.temporaryGroups.deadline.until')}
          </Button>
        ))}
      </div>
      {value.mode === 'for' ? (
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            inputMode="decimal"
            className="w-28"
            value={value.amount}
            onChange={(e) => set({ amount: e.target.value })}
            aria-label={t('pages.temporaryGroups.deadline.amount')}
          />
          <Select value={value.unit} onValueChange={(unit) => set({ unit: unit as Unit })}>
            <SelectTrigger className="w-36" aria-label={t('pages.temporaryGroups.deadline.unit')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['minutes', 'hours', 'days'] as const).map((u) => (
                <SelectItem key={u} value={u}>{t(`pages.temporaryGroups.deadline.units.${u}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <Input
          type="datetime-local"
          className="w-60"
          value={value.until}
          min={localInputValue(Date.now() + 60_000)}
          onChange={(e) => set({ until: e.target.value })}
          aria-label={t('pages.temporaryGroups.deadline.until')}
        />
      )}
    </div>
  );
}

function DeadlinePreview({ input, now }: { input: DeadlineInput; now: number }) {
  const { t } = useTranslation();
  const r = resolveDeadline(input, now);
  if ('problem' in r) return <p className="text-xs text-destructive" role="alert">{problemText(r.problem, t)}</p>;
  return <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.deadline.endsAt', { date: formatTempDate(r.expiresAt) })}</p>;
}

// ---- dialogs ----------------------------------------------------------------

interface GrantTarget {
  sgid: number;
  groupName: string;
  cldbid: number;
  clientName: string;
  /** The client is already in the group: the deadline ends that membership (needs the explicit confirmation). */
  setDeadline?: boolean;
}

/** Gives a group until a deadline, or (setDeadline) puts a deadline on a membership that exists. */
export function TempGrantDialog({ target, onClose }: { target: GrantTarget | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState<DeadlineInput>(DEFAULT_DEADLINE);
  const grant = useTemporaryGroupAction((c, s, body: Parameters<typeof groupsApi.grantTemporaryGroup>[2]) => groupsApi.grantTemporaryGroup(c, s, body));
  const now = Date.now();
  const resolved = resolveDeadline(input, now);
  const submit = () => {
    if (!target || 'problem' in resolved) return;
    grant.mutate({ sgid: target.sgid, cldbid: target.cldbid, setDeadline: target.setDeadline, ...resolved.body }, {
      onSuccess: (entry) => {
        toast.success(t('pages.temporaryGroups.granted', { name: target.clientName, group: target.groupName, date: formatTempDate(entry.expiresAt) }));
        onClose();
        setInput(DEFAULT_DEADLINE);
      },
      onError: (err) => toast.error(tempGroupErrorMessage(err, t)),
    });
  };
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(target?.setDeadline ? 'pages.temporaryGroups.setDeadlineTitle' : 'pages.temporaryGroups.grantTitle')}</DialogTitle>
          <DialogDescription>
            {t('pages.temporaryGroups.grantDescription', { name: target?.clientName, group: target?.groupName })}
          </DialogDescription>
        </DialogHeader>
        {target?.setDeadline && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" role="note">{t('pages.temporaryGroups.setDeadlineWarning')}</p>
        )}
        <DeadlineFields value={input} onChange={setInput} />
        <DeadlinePreview input={input} now={now} />
        <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.accuracyHint')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={grant.isPending || 'problem' in resolved}>
            {grant.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t(target?.setDeadline ? 'pages.temporaryGroups.setDeadline' : 'pages.temporaryGroups.grant')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Extends from the current expiry (or from now once it has passed), or sets a new date - also an earlier one. */
export function TempChangeDialog({ entry, groupName, onClose }: { entry: TemporaryGroupEntry | null; groupName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [input, setInput] = useState<DeadlineInput>({ ...DEFAULT_DEADLINE, amount: '7' });
  const update = useTemporaryGroupAction((c, s, { id, body }: { id: number; body: Parameters<typeof groupsApi.updateTemporaryGroup>[3] }) => groupsApi.updateTemporaryGroup(c, s, id, body));
  const now = Date.now();
  const current = entry ? Date.parse(entry.expiresAt) : now;
  // "for" extends; "until" sets the date as it is.
  const extendMs = durationOf(input);
  let resolved: { body: { extendByMs: number } | TempGroupDeadline; expiresAt: number } | { problem: number };
  if (input.mode === 'for') {
    const expiresAt = tempGroupExtendedExpiry(current, now, extendMs);
    resolved = tempGroupDurationProblem(extendMs) ? { problem: extendMs }
      : tempGroupDurationProblem(expiresAt - now) ? { problem: expiresAt - now }
      : { body: { extendByMs: extendMs }, expiresAt };
  } else {
    resolved = resolveDeadline(input, now);
  }
  const submit = () => {
    if (!entry || 'problem' in resolved) return;
    update.mutate({ id: entry.id, body: resolved.body }, {
      onSuccess: (e) => { toast.success(t('pages.temporaryGroups.changed', { date: formatTempDate(e.expiresAt) })); onClose(); },
      onError: (err) => toast.error(tempGroupErrorMessage(err, t)),
    });
  };
  return (
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.temporaryGroups.changeTitle')}</DialogTitle>
          <DialogDescription>
            {t('pages.temporaryGroups.changeDescription', { name: entry?.clientNickname || `#${entry?.cldbid}`, group: groupName, date: entry ? formatTempDate(entry.expiresAt) : '' })}
          </DialogDescription>
        </DialogHeader>
        <DeadlineFields value={input} onChange={setInput} forLabel={t('pages.temporaryGroups.deadline.extendBy')} />
        {input.mode === 'for' && Number.isFinite(extendMs) ? (
          // Both results as dates (decision 6): the one that applies is the later one.
          <ul className="text-xs space-y-0.5">
            {[
              { key: 'fromExpiry', at: current + extendMs, applies: current >= now },
              { key: 'fromNow', at: now + extendMs, applies: current < now },
            ].map((o) => (
              <li key={o.key} className={cn(o.applies ? 'font-medium' : 'text-muted-foreground')}>
                {t(`pages.temporaryGroups.extend.${o.key}`, { date: formatTempDate(o.at) })}
                {o.applies && ` ${t('pages.temporaryGroups.extend.applies')}`}
              </li>
            ))}
          </ul>
        ) : null}
        {'problem' in resolved
          ? <p className="text-xs text-destructive" role="alert">{problemText(resolved.problem, t)}</p>
          : input.mode === 'until' && <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.deadline.endsAt', { date: formatTempDate(resolved.expiresAt) })}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={update.isPending || 'problem' in resolved}>
            {update.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Make permanent" and "revoke now", each behind a confirmation. */
export function useTempEndActions() {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<{ entry: TemporaryGroupEntry; kind: 'permanent' | 'revoke'; groupName: string } | null>(null);
  const permanent = useTemporaryGroupAction((c, s, id: number) => groupsApi.makeTemporaryGroupPermanent(c, s, id));
  const revoke = useTemporaryGroupAction((c, s, id: number) => groupsApi.revokeTemporaryGroup(c, s, id));
  const busy = permanent.isPending || revoke.isPending;
  const run = () => {
    if (!confirm) return;
    const action = confirm.kind === 'permanent' ? permanent : revoke;
    action.mutate(confirm.entry.id, {
      onSuccess: (e) => {
        // A removal that TeamSpeak refused stays open (waiting/error) - say so instead of "done".
        if (isOpenTempGroupState(e.state)) toast.warning(t('pages.temporaryGroups.revokeRetrying', { reason: e.error ? tempNoteText(e.error, t) : '' }));
        else toast.success(t(confirm.kind === 'permanent' ? 'pages.temporaryGroups.madePermanent' : `pages.temporaryGroups.ended.${e.state}`));
        setConfirm(null);
      },
      onError: (err) => toast.error(tempGroupErrorMessage(err, t)),
    });
  };
  const dialog = (
    <ConfirmDialog
      open={!!confirm}
      onOpenChange={(open) => { if (!open) setConfirm(null); }}
      title={t(confirm?.kind === 'permanent' ? 'pages.temporaryGroups.permanentTitle' : 'pages.temporaryGroups.revokeTitle')}
      description={t(confirm?.kind === 'permanent' ? 'pages.temporaryGroups.permanentDescription' : 'pages.temporaryGroups.revokeDescription', {
        name: confirm?.entry.clientNickname || `#${confirm?.entry.cldbid}`, group: confirm?.groupName,
      })}
      confirmLabel={t(confirm?.kind === 'permanent' ? 'pages.temporaryGroups.makePermanent' : 'pages.temporaryGroups.revokeNow')}
      destructive={confirm?.kind === 'revoke'}
      onConfirm={run}
      loading={busy}
    />
  );
  return { ask: (entry: TemporaryGroupEntry, kind: 'permanent' | 'revoke', groupName: string) => setConfirm({ entry, kind, groupName }), dialog };
}

/** The three actions of an open entry. */
export function TempEntryActions({ entry, groupName, onChange, onEnd }: {
  entry: TemporaryGroupEntry; groupName: string;
  onChange: (e: TemporaryGroupEntry) => void;
  onEnd: (e: TemporaryGroupEntry, kind: 'permanent' | 'revoke', groupName: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1">
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange(entry)}>
        <Clock className="h-3 w-3 mr-1" /> {t('pages.temporaryGroups.change')}
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onEnd(entry, 'permanent', groupName)}>
        <InfinityIcon className="h-3 w-3 mr-1" /> {t('pages.temporaryGroups.makePermanent')}
      </Button>
      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => onEnd(entry, 'revoke', groupName)}>
        <UserMinus className="h-3 w-3 mr-1" /> {t('pages.temporaryGroups.revokeNow')}
      </Button>
    </div>
  );
}

// ---- the "Temporary" tab ----------------------------------------------------

/** Admin only: how many days ended entries stay in the history. */
function RetentionField() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['temporary-groups-settings'], queryFn: settingsApi.getTemporaryGroupSettings });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (days: number) => settingsApi.setTemporaryGroupRetention(days),
    onSuccess: () => { toast.success(t('pages.temporaryGroups.retention.saved')); setDraft(null); qc.invalidateQueries({ queryKey: ['temporary-groups-settings'] }); },
    onError: (err) => toast.error(tempGroupErrorMessage(err, t)),
  });
  if (!data) return null;
  const value = draft ?? String(data.retentionDays);
  const days = Number(value);
  const valid = Number.isInteger(days) && days >= data.retentionMin && days <= data.retentionMax;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Label htmlFor="temp-group-retention" className="text-xs">{t('pages.temporaryGroups.retention.label')}</Label>
      <Input
        id="temp-group-retention" type="number" className="h-8 w-24" min={data.retentionMin} max={data.retentionMax}
        value={value} onChange={(e) => setDraft(e.target.value)} aria-invalid={!valid}
      />
      <span className="text-muted-foreground">{t('pages.temporaryGroups.retention.days', { min: data.retentionMin, max: data.retentionMax })}</span>
      {draft !== null && (
        <Button size="sm" className="h-8" disabled={!valid || save.isPending} onClick={() => save.mutate(days)}>{t('common.save')}</Button>
      )}
    </div>
  );
}

export function TemporaryGroupsPanel({ groups }: { groups: Array<{ sgid: number | string; name: string }> }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'open' | 'history'>('open');
  const { data, isLoading, isError } = useTemporaryGroups(scope);
  const [changing, setChanging] = useState<TemporaryGroupEntry | null>(null);
  const end = useTempEndActions();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const groupName = useMemo(() => {
    const names = new Map(groups.map((g) => [Number(g.sgid), g.name]));
    return (sgid: number) => names.get(sgid) ?? `#${sgid}`;
  }, [groups]);
  const now = Date.now();
  const rows = data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="radiogroup" aria-label={t('pages.temporaryGroups.scopeLabel')}>
          {(['open', 'history'] as const).map((s) => (
            <Button key={s} size="sm" role="radio" aria-checked={scope === s} variant={scope === s ? 'default' : 'outline'} onClick={() => setScope(s)}>
              {t(`pages.temporaryGroups.scope.${s}`)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('pages.temporaryGroups.accuracyHint')}</p>
      </div>
      {isLoading ? <PageLoader /> : isError ? (
        <p className="text-sm text-destructive">{t('pages.temporaryGroups.loadFailed')}</p>
      ) : (
        <div className="card-hero rounded-md border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground">
                <th className="h-10 px-3 font-medium">{t('pages.temporaryGroups.columns.client')}</th>
                <th className="h-10 px-3 font-medium">{t('pages.temporaryGroups.columns.group')}</th>
                <th className="h-10 px-3 font-medium">{t('pages.temporaryGroups.columns.granted')}</th>
                <th className="h-10 px-3 font-medium">{t(scope === 'open' ? 'pages.temporaryGroups.columns.expires' : 'pages.temporaryGroups.columns.ended')}</th>
                <th className="h-10 px-3 font-medium">{t('pages.temporaryGroups.columns.state')}</th>
                {scope === 'open' && <th className="h-10 px-3 font-medium">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="h-24 text-center text-muted-foreground">{t(`pages.temporaryGroups.empty.${scope}`)}</td></tr>
              ) : rows.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 align-top" data-testid="temp-group-row">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{e.clientNickname || `#${e.cldbid}`}</div>
                    <div className="text-xs text-muted-foreground font-mono-data">{t('pages.serverGroups.dbidLabel', { id: e.cldbid })}</div>
                  </td>
                  <td className="px-3 py-2.5">{groupName(e.sgid)}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    <div>{formatTempDate(e.grantedAt)}</div>
                    <div className="text-muted-foreground">{t('pages.temporaryGroups.by', { name: e.grantedBy })}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    {scope === 'open' ? (
                      <>
                        <div>{formatTempDate(e.expiresAt)}</div>
                        <div className="text-muted-foreground">{formatRemaining(Date.parse(e.expiresAt) - now, t)}</div>
                      </>
                    ) : (e.endedAt ? formatTempDate(e.endedAt) : '-')}
                  </td>
                  <td className="px-3 py-2.5">
                    <TempStateBadge state={e.state} />
                    {e.wasMember && <div className="text-xs text-muted-foreground mt-1">{t('pages.temporaryGroups.wasMember')}</div>}
                    <NoticeLine notice={e.lastNotice} pending={e.pendingNotice} />
                    {e.error && <div className={cn('text-xs mt-1 max-w-[280px]', isOpenTempGroupState(e.state) ? 'text-destructive' : 'text-muted-foreground')}>{tempNoteText(e.error, t)}</div>}
                  </td>
                  {scope === 'open' && (
                    <td className="px-3 py-2.5">
                      <TempEntryActions entry={e} groupName={groupName(e.sgid)} onChange={setChanging} onEnd={end.ask} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {scope === 'history' && isAdmin && <RetentionField />}
      {isAdmin && <NoticeSettingsCard />}
      <TempChangeDialog entry={changing} groupName={changing ? groupName(changing.sgid) : ''} onClose={() => setChanging(null)} />
      {end.dialog}
    </div>
  );
}
