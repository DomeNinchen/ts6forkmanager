import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, Check, X, Ban, ArrowRight, Info, Layers, Lightbulb } from 'lucide-react';
import { PERMISSION_ACTIONS, type PermissionAction, type PermissionCheck } from '@ts6/common';
import { permissionsApi, type ExplainResult, type ExplainRow } from '@/api/permissions.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { tsErrorMessage } from '@/lib/ts-errors';
import { cn } from '@/lib/utils';

// R11 "Why?": pick who acts, what, and on whom; the backend evaluates it from the Permission Overview
// data (rules measured against TeamSpeak) and this panel words the answer, names each value's source and
// points at the editor of the entry to change. It never changes anything itself.

type PermLayer = 'server-group' | 'channel-group' | 'channel' | 'client' | 'channel-client';
export interface SourceInfo { tierLabel: string; name: string; hit: { layer: PermLayer; key: string } }

interface Props {
  configId: number;
  sid: number;
  clients: { id: string; name: string; online: boolean }[];
  clientsLoading: boolean;
  channels: { cid: string; name: string }[];
  serverGroups: { sgid: string; name: string }[];
  describeSource: (row: ExplainRow) => SourceInfo;
  permDesc: (permsid: string) => string;
  onJump: (hit: SourceInfo['hit'], permsid: string) => void;
  onShowOverview: (cldbid: string, cid: string) => void;
}

const BAN_PRESETS = [{ key: 'hour', seconds: 3600 }, { key: 'day', seconds: 86400 }, { key: 'month', seconds: 30 * 86400 }, { key: 'permanent', seconds: 0 }] as const;
const CLIENT_LIST_LIMIT = 50;

function ClientField({ id, label, clients, loading, value, onChange }: {
  id: string; label: string; clients: Props['clients']; loading: boolean; value: string; onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.id === needle);
  }, [clients, q]);
  const selected = clients.find((c) => c.id === value);
  const shown = matches.slice(0, CLIENT_LIST_LIMIT);
  // One tab stop for the list (the selected row, else the first); arrow keys move between rows
  const tabRow = shown.some((c) => c.id === value) ? value : shown[0]?.id;
  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]')];
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    e.preventDefault();
  };
  return (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pages.permissions.searchClientsPlaceholder')} className="h-8 pl-7 text-xs" />
      </div>
      <div role="listbox" aria-label={label} onKeyDown={onListKey} className="h-36 overflow-y-auto rounded-md border border-border/50 p-1 space-y-0.5">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            role="option"
            tabIndex={c.id === tabRow ? 0 : -1}
            aria-selected={value === c.id}
            aria-label={`${c.name} (#${c.id}, ${c.online ? t('common.online') : t('common.offline')})`}
            onClick={() => onChange(c.id)}
            className={cn('w-full text-left px-2 py-1 rounded-sm text-xs flex items-center gap-2 transition-colors',
              value === c.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50')}
          >
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', c.online ? 'bg-emerald-500' : 'bg-zinc-500')}
              title={c.online ? t('common.online') : t('common.offline')} />
            <span className="truncate flex-1">{c.name}</span>
            <span className="text-[10px] font-mono-data text-muted-foreground">#{c.id}</span>
          </button>
        ))}
        {matches.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">{loading ? t('common.loading') : t('pages.permissions.noClientsFound')}</p>
        )}
        {matches.length > CLIENT_LIST_LIMIT && (
          <p className="text-[10px] text-muted-foreground text-center py-1">{t('pages.permissions.why.moreClients', { count: matches.length - CLIENT_LIST_LIMIT })}</p>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground truncate">
        {selected ? t('pages.permissions.why.selected', { name: selected.name }) : t('pages.permissions.why.noneSelected')}
      </p>
    </div>
  );
}

export function WhyPanel({ configId, sid, clients, clientsLoading, channels, serverGroups, describeSource, permDesc, onJump, onShowOverview }: Props) {
  const { t } = useTranslation();
  const [actor, setActor] = useState('');
  const [target, setTarget] = useState('');
  const [action, setAction] = useState<PermissionAction>('kick-server');
  const [sgid, setSgid] = useState('');
  const [destination, setDestination] = useState('');
  const [banPreset, setBanPreset] = useState<string>('day');
  const [customSeconds, setCustomSeconds] = useState('');

  const isGroup = action === 'group-add' || action === 'group-remove';
  const duration = banPreset === 'custom' ? Number(customSeconds) : BAN_PRESETS.find((p) => p.key === banPreset)!.seconds;
  const durationValid = banPreset !== 'custom' || (Number.isInteger(duration) && duration > 0);
  const missing = !actor ? 'actor' : !target ? 'target' : actor === target ? 'same'
    : isGroup && !sgid ? 'group' : action === 'move' && !destination ? 'destination'
    : action === 'ban' && !durationValid ? 'duration' : null;

  const explain = useMutation({
    mutationFn: () => permissionsApi.explain(configId, sid, {
      actor: Number(actor), target: Number(target), action,
      ...(isGroup ? { sgid: Number(sgid) } : {}),
      ...(action === 'move' ? { destination: Number(destination) } : {}),
      ...(action === 'ban' ? { duration } : {}),
    }),
  });

  const nameOf = (cldbid: number | string) => clients.find((c) => c.id === String(cldbid))?.name ?? t('pages.permissions.clientFallback', { id: cldbid });
  const channelName = (cid: number | string | null) => channels.find((ch) => ch.cid === String(cid))?.name ?? t('pages.permissions.channelFallback', { id: cid });
  const groupName = (id: number | string | null) => serverGroups.find((g) => g.sgid === String(id))?.name ?? t('pages.permissions.serverGroupFallback', { id });

  const errorText = (err: any): string => {
    const code = err?.response?.data?.code;
    if (typeof code === 'string' && ['actor-not-found', 'target-not-found', 'group-not-found', 'destination-not-found'].includes(code)) {
      return t(`pages.permissions.why.error.${code}`);
    }
    // No answer, or a proxy's 502-504 without the backend's JSON: the manager itself is not reachable
    const data = err?.response?.data;
    if (!err?.response || ([502, 503, 504].includes(err.response.status) && !(data && typeof data === 'object' && 'error' in data))) {
      return t('pages.permissions.why.error.network');
    }
    // The backend's TSApiError for a request that never reached TeamSpeak
    if (code === -1) return t('pages.permissions.why.error.tsUnreachable');
    return tsErrorMessage(err, t('pages.permissions.why.error.generic'), t);
  };

  return (
    <div className="space-y-4">
      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('pages.permissions.why.title')}</CardTitle>
          <p className="text-[11px] text-muted-foreground pt-1">{t('pages.permissions.why.explanation')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
            <ClientField id="why-actor" label={t('pages.permissions.why.actor')} clients={clients} loading={clientsLoading} value={actor} onChange={setActor} />
            <div className="space-y-3 min-w-0">
              <div className="space-y-1.5">
                <Label htmlFor="why-action" className="text-xs">{t('pages.permissions.why.action')}</Label>
                <Select value={action} onValueChange={(v) => { setAction(v as PermissionAction); explain.reset(); }}>
                  <SelectTrigger id="why-action" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERMISSION_ACTIONS.map((a) => <SelectItem key={a} value={a}>{t(`pages.permissions.why.actions.${a}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isGroup && (
                <div className="space-y-1.5">
                  <Label htmlFor="why-group" className="text-xs">{t('pages.permissions.why.group')}</Label>
                  <Select value={sgid} onValueChange={setSgid}>
                    <SelectTrigger id="why-group" className="h-8 text-xs"><SelectValue placeholder={t('pages.permissions.choosePlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      {serverGroups.map((g) => <SelectItem key={g.sgid} value={g.sgid}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {action === 'move' && (
                <div className="space-y-1.5">
                  <Label htmlFor="why-destination" className="text-xs">{t('pages.permissions.why.destination')}</Label>
                  <Select value={destination} onValueChange={setDestination}>
                    <SelectTrigger id="why-destination" className="h-8 text-xs"><SelectValue placeholder={t('pages.permissions.choosePlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      {channels.map((ch) => <SelectItem key={ch.cid} value={ch.cid}>{ch.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {action === 'ban' && (
                <div className="space-y-1.5">
                  <Label htmlFor="why-duration" className="text-xs">{t('pages.permissions.why.duration')}</Label>
                  <Select value={banPreset} onValueChange={setBanPreset}>
                    <SelectTrigger id="why-duration" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BAN_PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{t(`pages.permissions.why.durations.${p.key}`)}</SelectItem>)}
                      <SelectItem value="custom">{t('pages.permissions.why.durations.custom')}</SelectItem>
                    </SelectContent>
                  </Select>
                  {banPreset === 'custom' && (
                    <Input type="number" min={1} value={customSeconds} onChange={(e) => setCustomSeconds(e.target.value)}
                      aria-label={t('pages.permissions.why.durationSeconds')} placeholder={t('pages.permissions.why.durationSeconds')} className="h-8 text-xs" />
                  )}
                </div>
              )}
              <Button className="w-full" disabled={!!missing || explain.isPending} onClick={() => explain.mutate()}>
                {t('pages.permissions.why.check')}
              </Button>
              {missing && <p className="text-[11px] text-muted-foreground">{t(`pages.permissions.why.missing.${missing}`)}</p>}
            </div>
            <ClientField id="why-target" label={t('pages.permissions.why.target')} clients={clients} loading={clientsLoading} value={target} onChange={setTarget} />
          </div>
        </CardContent>
      </Card>

      {explain.isPending && <div className="flex justify-center py-8"><PageLoader /></div>}
      {explain.isError && (
        <Card className="card-hero border-destructive/40"><CardContent className="py-4 text-sm text-destructive" role="alert">{errorText(explain.error)}</CardContent></Card>
      )}
      {explain.data && !explain.isPending && (
        <Result
          result={explain.data}
          nameOf={nameOf} channelName={channelName} groupName={groupName}
          describeSource={describeSource} permDesc={permDesc} onJump={onJump} onShowOverview={onShowOverview}
        />
      )}
    </div>
  );
}

function Result({ result, nameOf, channelName, groupName, describeSource, permDesc, onJump, onShowOverview }: {
  result: ExplainResult;
  nameOf: (id: number | string) => string;
  channelName: (cid: number | string | null) => string;
  groupName: (id: number | string | null) => string;
} & Pick<Props, 'describeSource' | 'permDesc' | 'onJump' | 'onShowOverview'>) {
  const { t } = useTranslation();
  const { context: ctx } = result;
  const actor = nameOf(ctx.actor.cldbid);
  const target = nameOf(ctx.target.cldbid);
  const scopeCid = (scope: string) => scope === 'target-channel' ? ctx.target.cid : scope === 'destination' ? ctx.destination : ctx.actor.cid;
  const scopeText = (scope: string): string => {
    if (scope === 'group') return t('pages.permissions.why.scope.group', { group: groupName(ctx.sgid) });
    if (scope === 'server') return t('pages.permissions.why.scope.server');
    return t(`pages.permissions.why.scope.${scope}`, { actor, target, channel: channelName(scopeCid(scope)) });
  };
  const tone = result.verdict === 'allowed' ? 'text-emerald-500' : result.verdict === 'denied' ? 'text-destructive' : 'text-amber-500';
  const Icon = result.verdict === 'allowed' ? Check : result.verdict === 'denied' ? X : Ban;

  const value = (v: number, permsid: string) => permsid.startsWith('b_') ? (v >= 1 ? t('pages.permissions.why.yes') : t('pages.permissions.why.no')) : String(v);

  const fixFor = (c: PermissionCheck<ExplainRow>): { text: string; hit: SourceInfo['hit'] } | null => {
    if (c.ok) return null;
    const src = c.have.source ? describeSource(c.have.source) : null;
    // Nothing sets it: a client permission of the actor is the most direct place to add it.
    const hit = src?.hit ?? { layer: 'client' as const, key: String(ctx.actor.cldbid) };
    const where = src ? t('pages.permissions.why.fix.where', { tier: src.tierLabel, name: src.name }) : '';
    const perm = c.have.permission;
    let text: string;
    if (c.kind === 'ban-time') {
      text = src
        ? t(c.duration === 0 ? 'pages.permissions.why.fix.banPermanent' : 'pages.permissions.why.fix.banTime', { perm, where, duration: c.duration })
        : t(c.duration === 0 ? 'pages.permissions.why.fix.banPermanentUnset' : 'pages.permissions.why.fix.banTimeUnset', { perm, actor, duration: c.duration });
    } else if (c.kind === 'flag') {
      text = src ? t('pages.permissions.why.fix.flag', { perm, where }) : t('pages.permissions.why.fix.flagUnset', { perm, actor });
    } else {
      const need = c.need!.value;
      text = src ? t('pages.permissions.why.fix.raise', { perm, where, have: c.have.value, need }) : t('pages.permissions.why.fix.raiseUnset', { perm, actor, need });
    }
    if (c.have.source?.permnegated) text += ` ${t('pages.permissions.why.fix.negated')}`;
    if (src && (c.have.source!.rank >= 3)) text += ` ${t('pages.permissions.why.fix.channelScoped', { channel: channelName(scopeCid(c.have.scope)) })}`;
    return { text, hit };
  };

  const SourceLine = ({ row, scope, groupSgid }: { row: ExplainRow | null; scope: string; groupSgid?: number }) => {
    const src = row ? describeSource(row) : null;
    return (
      <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1">
        {src ? (
          <button type="button" onClick={() => onJump(src.hit, row!.permsid)} className="inline-flex items-center gap-1 hover:text-foreground underline-offset-2 hover:underline"
            title={t('pages.permissions.why.openInEditor')}>
            <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{src.tierLabel}</Badge>
            <span>{src.name}</span>
            {row!.permnegated ? <sup className="text-destructive text-[9px]">N</sup> : null}
            {row!.permskip ? <sup className="text-amber-400 text-[9px]">S</sup> : null}
          </button>
        ) : groupSgid !== undefined ? (
          <button type="button" onClick={() => onJump({ layer: 'server-group', key: String(groupSgid) }, '')} className="hover:text-foreground hover:underline underline-offset-2"
            title={t('pages.permissions.why.openInEditor')}>
            <Badge variant="secondary" className="text-[9px] h-4 px-1.5 mr-1">{t('pages.permissions.why.groupSetting')}</Badge>{groupName(groupSgid)}
          </button>
        ) : (
          <span className="italic">{t('pages.permissions.why.notSet')}</span>
        )}
        {groupSgid === undefined && <span>· {scopeText(scope)}</span>}
      </div>
    );
  };

  return (
    <Card className="card-hero">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-3" role="status">
          <Icon className={cn('h-6 w-6', tone)} aria-hidden />
          <div>
            <p className={cn('text-base font-semibold', tone)}>{t(`pages.permissions.why.verdict.${result.verdict}`)}</p>
            <p className="text-xs text-muted-foreground">
              {actor} <ArrowRight className="inline h-3 w-3" aria-hidden /> {t(`pages.permissions.why.actions.${result.action}`)} <ArrowRight className="inline h-3 w-3" aria-hidden /> {target}
            </p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => onShowOverview(String(ctx.actor.cldbid), String(ctx.target.online ? ctx.target.cid : ctx.actor.cid))}>
            <Layers className="h-3.5 w-3.5 mr-1" /> {t('pages.permissions.why.showOverview', { name: actor })}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.notes.length > 0 && (
          <ul className="space-y-1">
            {result.notes.map((n) => (
              <li key={n} className="flex gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
                <span>{t(`pages.permissions.why.notes.${n}`, { actor, target, channel: channelName(ctx.defaultCid), group: groupName(ctx.sgid) })}</span>
              </li>
            ))}
          </ul>
        )}
        {result.checks.map((c, i) => {
          const fix = result.verdict === 'impossible' ? null : fixFor(c);
          return (
            <div key={i} className={cn('rounded-md border p-3 space-y-2', c.ok ? 'border-border/50' : 'border-destructive/40')}>
              <div className="flex items-start gap-2">
                {c.ok ? <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" aria-label={t('pages.permissions.why.checkOk')} />
                  : <X className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-label={t('pages.permissions.why.checkFailed')} />}
                <p className="text-xs">{t(`pages.permissions.why.checkText.${c.kind === 'ban-time' && c.duration === 0 ? 'ban-time-permanent' : c.kind}`, {
                  actor, have: value(c.have.value, c.have.permission), need: c.need ? value(c.need.value, c.need.permission) : '',
                  duration: c.duration === 0 ? t('pages.permissions.why.durations.permanent') : t('pages.permissions.why.seconds', { count: c.duration ?? 0 }),
                })}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 pl-6">
                <div className="min-w-0">
                  <p className="font-mono-data text-[11px] truncate" title={permDesc(c.have.permission)}>{c.have.permission} = {value(c.have.value, c.have.permission)}</p>
                  <SourceLine row={c.have.source} scope={c.have.scope} />
                </div>
                {c.need && (
                  <div className="min-w-0">
                    <p className="font-mono-data text-[11px] truncate" title={permDesc(c.need.permission)}>{c.need.permission} = {c.need.value}</p>
                    <SourceLine row={c.need.scope === 'group' ? null : (c.need.source as ExplainRow | null)} scope={c.need.scope}
                      groupSgid={c.need.scope === 'group' ? (c.need as { sgid: number }).sgid : undefined} />
                  </div>
                )}
              </div>
              {fix && (
                <div className="pl-6 flex flex-wrap items-center gap-2 text-xs">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden />
                  <span className="flex-1 min-w-[12rem]">{fix.text}</span>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onJump(fix.hit, c.have.permission)}>
                    {t('pages.permissions.why.openInEditor')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
