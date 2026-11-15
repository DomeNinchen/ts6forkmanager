import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Search, Check, X, Ban, ArrowRight, Info, Layers, Lightbulb, Plus, Trash2, FlaskConical, Clock, Copy, Download } from 'lucide-react';
import { PERMISSION_ACTIONS, WHATIF_MAX_CHANGES, type PermissionAction, type PermissionCheck, type PermissionVerdict, type WhatIfChange, type WhatIfWho } from '@ts6/common';
import { permissionsApi, type ExplainResult, type ExplainRow, type WhatIfExplainResult } from '@/api/permissions.api';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuthStore } from '@/stores/auth.store';
import { useTemporaryGroups } from '@/hooks/use-groups';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { tsErrorMessage } from '@/lib/ts-errors';
import { downloadTextFile } from '@/lib/console/events';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// R11 "Why?": pick who acts, what, and on whom; the backend evaluates it from the Permission Overview
// data (rules measured against TeamSpeak) and this panel words the answer, names each value's source and
// points at the editor of the entry to change. It never changes anything itself.

type PermLayer = 'server-group' | 'channel-group' | 'channel' | 'client' | 'channel-client';
export interface SourceInfo { tierLabel: string; name: string; hit: { layer: PermLayer; key: string } }

/** Planned changes handed over from the editor ("Why? with these changes"); a new `seq` replaces the list. */
export interface WhyPrefill { seq: number; changes: WhatIfChange[]; actor?: string; target?: string }

interface Props {
  prefill?: WhyPrefill;
  configId: number;
  sid: number;
  clients: { id: string; name: string; online: boolean }[];
  clientsLoading: boolean;
  channels: { cid: string; name: string }[];
  serverGroups: { sgid: string; name: string }[];
  /** Regular channel groups (the ones a client can be given). */
  channelGroups: { cgid: string; name: string }[];
  /** Every permission name (permsid), for the "what if" value changes. */
  permissions: string[];
  describeSource: (row: ExplainRow) => SourceInfo;
  permDesc: (permsid: string) => string;
  onJump: (hit: SourceInfo['hit'], permsid: string) => void;
  onShowOverview: (cldbid: string, cid: string) => void;
}

const BAN_PRESETS = [{ key: 'hour', seconds: 3600 }, { key: 'day', seconds: 86400 }, { key: 'month', seconds: 30 * 86400 }, { key: 'permanent', seconds: 0 }] as const;
const CLIENT_LIST_LIMIT = 50;

/** Stage 4b: how many actors one comparison may hold (each costs its own set of read commands). */
export const WHY_MAX_ACTORS = 10;

type One = { plain: ExplainResult } | { whatif: WhatIfExplainResult };
interface ManyRow { actor: string; data?: One; error?: unknown }
interface Asked { action: PermissionAction; actors: string[]; target: string; changes: WhatIfChange[]; sgid?: number; destination?: number; duration?: number }

/** One client (value: string) or, in the several-actors comparison, a set of clients (value: string[], click toggles). */
function ClientField({ id, label, clients, loading, value, onChange }: {
  id: string; label: string; clients: Props['clients']; loading: boolean; value: string | string[]; onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.id === needle);
  }, [clients, q]);
  const multi = Array.isArray(value);
  const isSel = (cid: string) => (multi ? value.includes(cid) : value === cid);
  const selected = multi ? undefined : clients.find((c) => c.id === value);
  const shown = matches.slice(0, CLIENT_LIST_LIMIT);
  // One tab stop for the list (the selected row, else the first); arrow keys move between rows
  const tabRow = shown.find((c) => isSel(c.id))?.id ?? shown[0]?.id;
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
      <div role="listbox" aria-label={label} aria-multiselectable={multi || undefined} onKeyDown={onListKey} className="h-36 overflow-y-auto rounded-md border border-border/50 p-1 space-y-0.5">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            role="option"
            tabIndex={c.id === tabRow ? 0 : -1}
            aria-selected={isSel(c.id)}
            aria-label={`${c.name} (#${c.id}, ${c.online ? t('common.online') : t('common.offline')})`}
            onClick={() => onChange(c.id)}
            className={cn('w-full text-left px-2 py-1 rounded-sm text-xs flex items-center gap-2 transition-colors',
              isSel(c.id) ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50')}
          >
            {multi && <Check className={cn('h-3 w-3 shrink-0', isSel(c.id) ? 'opacity-100' : 'opacity-0')} aria-hidden />}
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
        {multi ? t('pages.permissions.why.multi.selectedCount', { count: value.length, max: WHY_MAX_ACTORS })
          : selected ? t('pages.permissions.why.selected', { name: selected.name }) : t('pages.permissions.why.noneSelected')}
      </p>
    </div>
  );
}

const CHANGE_KINDS = ['add', 'remove', 'group-perm', 'client-perm', 'cg-assign', 'cg-perm', 'ch-perm', 'cc-perm'] as const;
type ChangeKind = typeof CHANGE_KINDS[number];

/** R11 stage 4 "what if": the planned changes, each added from a small form; the list is what gets simulated. */
function WhatIfEditor({ changes, onChange, serverGroups, channelGroups, channels, permissions, describe, tempUntil }: {
  changes: WhatIfChange[];
  onChange: (next: WhatIfChange[]) => void;
  serverGroups: Props['serverGroups'];
  channelGroups: Props['channelGroups'];
  channels: Props['channels'];
  permissions: string[];
  describe: (c: WhatIfChange) => string;
  tempUntil: (c: WhatIfChange) => string | null;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ChangeKind>('add');
  const [who, setWho] = useState<WhatIfWho>('actor');
  const [sgid, setSgid] = useState('');
  const [cgid, setCgid] = useState('');
  const [cid, setCid] = useState('');
  const [permsid, setPermsid] = useState('');
  const [value, setValue] = useState('');
  const [removeValue, setRemoveValue] = useState(false);
  const [negated, setNegated] = useState(false);
  const [skip, setSkip] = useState(false);

  const needsGroup = kind === 'add' || kind === 'remove' || kind === 'group-perm';
  const needsChannelGroup = kind === 'cg-assign' || kind === 'cg-perm';
  const needsChannel = kind === 'cg-assign' || kind === 'ch-perm' || kind === 'cc-perm';
  const needsWho = kind !== 'group-perm' && kind !== 'cg-perm' && kind !== 'ch-perm';
  const isValue = !['add', 'remove', 'cg-assign'].includes(kind);
  // Only group values carry a negate flag in TeamSpeak
  const canNegate = kind === 'group-perm' || kind === 'cg-perm';
  const n = Number(value);
  const problem = needsGroup && !sgid ? 'group'
    : needsChannelGroup && !cgid ? 'channelGroup'
    : needsChannel && !cid ? 'channel'
    : isValue && !permissions.includes(permsid.trim()) ? 'permission'
    : isValue && !removeValue && (value.trim() === '' || !Number.isInteger(n)) ? 'value'
    : changes.length >= WHATIF_MAX_CHANGES ? 'tooMany' : null;

  const add = () => {
    const v = removeValue ? null : { permvalue: n, ...(canNegate ? { permnegated: negated } : {}), permskip: skip };
    const p = permsid.trim();
    const c: WhatIfChange = kind === 'add' || kind === 'remove' ? { kind: 'group-member', who, sgid: Number(sgid), op: kind }
      : kind === 'group-perm' ? { kind: 'group-perm', sgid: Number(sgid), permsid: p, value: v }
      : kind === 'client-perm' ? { kind: 'client-perm', who, permsid: p, value: v }
      : kind === 'cg-assign' ? { kind: 'channel-group-member', who, cid: Number(cid), cgid: Number(cgid) }
      : kind === 'cg-perm' ? { kind: 'channel-group-perm', cgid: Number(cgid), permsid: p, value: v }
      : kind === 'ch-perm' ? { kind: 'channel-perm', cid: Number(cid), permsid: p, value: v }
      : { kind: 'channel-client-perm', who, cid: Number(cid), permsid: p, value: v };
    onChange([...changes, c]);
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border/60 p-3">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('pages.permissions.why.whatif.title')}</h3>
      </div>
      <p className="text-[11px] text-muted-foreground">{t('pages.permissions.why.whatif.explanation')}</p>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor="whatif-kind" className="text-xs">{t('pages.permissions.why.whatif.kind')}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as ChangeKind)}>
            <SelectTrigger id="whatif-kind" className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANGE_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`pages.permissions.why.whatif.kinds.${k}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {needsWho && (
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="whatif-who" className="text-xs">{t('pages.permissions.why.whatif.who')}</Label>
            <Select value={who} onValueChange={(v) => setWho(v as WhatIfWho)}>
              <SelectTrigger id="whatif-who" className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="actor">{t('pages.permissions.why.actor')}</SelectItem>
                <SelectItem value="target">{t('pages.permissions.why.target')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {needsGroup && (
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="whatif-group" className="text-xs">{t('pages.permissions.why.group')}</Label>
            <Select value={sgid} onValueChange={setSgid}>
              <SelectTrigger id="whatif-group" className="h-8 text-xs"><SelectValue placeholder={t('pages.permissions.choosePlaceholder')} /></SelectTrigger>
              <SelectContent>
                {serverGroups.map((g) => <SelectItem key={g.sgid} value={g.sgid}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {needsChannel && (
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="whatif-channel" className="text-xs">{t('pages.permissions.why.whatif.channel')}</Label>
            <Select value={cid} onValueChange={setCid}>
              <SelectTrigger id="whatif-channel" className="h-8 text-xs"><SelectValue placeholder={t('pages.permissions.choosePlaceholder')} /></SelectTrigger>
              <SelectContent>
                {channels.map((ch) => <SelectItem key={ch.cid} value={ch.cid}>{ch.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {needsChannelGroup && (
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor="whatif-cgroup" className="text-xs">{t('pages.permissions.why.whatif.channelGroup')}</Label>
            <Select value={cgid} onValueChange={setCgid}>
              <SelectTrigger id="whatif-cgroup" className="h-8 text-xs"><SelectValue placeholder={t('pages.permissions.choosePlaceholder')} /></SelectTrigger>
              <SelectContent>
                {channelGroups.map((g) => <SelectItem key={g.cgid} value={g.cgid}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {isValue && (
          <>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="whatif-perm" className="text-xs">{t('pages.permissions.why.whatif.permission')}</Label>
              <Input id="whatif-perm" list="whatif-perm-list" value={permsid} onChange={(e) => setPermsid(e.target.value)}
                placeholder="i_client_kick_from_server_power" className="h-8 text-xs font-mono-data" autoComplete="off" />
              <datalist id="whatif-perm-list">{permissions.map((p) => <option key={p} value={p} />)}</datalist>
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label htmlFor="whatif-value" className="text-xs">{t('pages.permissions.why.whatif.value')}</Label>
              <Input id="whatif-value" type="number" value={value} disabled={removeValue} onChange={(e) => setValue(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 sm:col-span-2 lg:col-span-3 text-xs">
              <label className="flex items-center gap-1.5"><Checkbox checked={removeValue} onCheckedChange={(v) => setRemoveValue(!!v)} />{t('pages.permissions.why.whatif.removeValue')}</label>
              {canNegate && <label className="flex items-center gap-1.5"><Checkbox checked={negated} disabled={removeValue} onCheckedChange={(v) => setNegated(!!v)} />{t('pages.permissions.why.whatif.negated')}</label>}
              <label className="flex items-center gap-1.5"><Checkbox checked={skip} disabled={removeValue} onCheckedChange={(v) => setSkip(!!v)} />{t('pages.permissions.why.whatif.skip')}</label>
            </div>
          </>
        )}
        <Button variant="outline" size="sm" className="h-8 text-xs" disabled={!!problem} onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1" aria-hidden /> {t('pages.permissions.why.whatif.add')}
        </Button>
      </div>
      {problem && <p className="text-[11px] text-muted-foreground">{t(`pages.permissions.why.whatif.missing.${problem}`, { max: WHATIF_MAX_CHANGES })}</p>}
      {changes.length > 0 && (
        <ol className="space-y-1" aria-label={t('pages.permissions.why.whatif.planned')}>
          {changes.map((c, i) => {
            const until = tempUntil(c);
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-sm bg-muted/30 px-2 py-1 text-xs">
                <span className="text-muted-foreground font-mono-data">{i + 1}.</span>
                <span className="flex-1 min-w-[10rem]">{describe(c)}</span>
                {until && <span className="inline-flex items-center gap-1 text-[11px] text-amber-500"><Clock className="h-3 w-3" aria-hidden />{t('pages.permissions.why.whatif.temporary', { until })}</span>}
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label={t('pages.permissions.why.whatif.removeChange', { n: i + 1 })}
                  onClick={() => onChange(changes.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function WhyPanel({ prefill, configId, sid, clients, clientsLoading, channels, serverGroups, channelGroups, permissions, describeSource, permDesc, onJump, onShowOverview }: Props) {
  const { t, i18n } = useTranslation();
  const [changes, setChanges] = useState<WhatIfChange[]>([]);
  const [actor, setActor] = useState('');
  const [target, setTarget] = useState('');
  const [action, setAction] = useState<PermissionAction>('kick-server');
  const [sgid, setSgid] = useState('');
  const [destination, setDestination] = useState('');
  const [banPreset, setBanPreset] = useState<string>('day');
  const [customSeconds, setCustomSeconds] = useState('');

  // Stage 4b: several actors against one target; each is asked on its own (planned "actor" changes apply to each)
  const [multi, setMulti] = useState(false);
  const [actors, setActors] = useState<string[]>([]);
  const [detail, setDetail] = useState<string | null>(null);

  const isGroup = action === 'group-add' || action === 'group-remove';
  const duration = banPreset === 'custom' ? Number(customSeconds) : BAN_PRESETS.find((p) => p.key === banPreset)!.seconds;
  const durationValid = banPreset !== 'custom' || (Number.isInteger(duration) && duration > 0);
  const actorIds = multi ? actors : actor ? [actor] : [];
  const missing = actorIds.length === 0 ? 'actor' : !target ? 'target' : actorIds.includes(target) ? 'same'
    : isGroup && !sgid ? 'group' : action === 'move' && !destination ? 'destination'
    : action === 'ban' && !durationValid ? 'duration' : null;

  const askOne = async (actorId: string): Promise<One> => {
    const params = {
      actor: Number(actorId), target: Number(target), action,
      ...(isGroup ? { sgid: Number(sgid) } : {}),
      ...(action === 'move' ? { destination: Number(destination) } : {}),
      ...(action === 'ban' ? { duration } : {}),
    };
    return changes.length > 0
      ? { whatif: await permissionsApi.explainWhatIf(configId, sid, { ...params, changes }) }
      : { plain: await permissionsApi.explain(configId, sid, params) };
  };
  const explain = useMutation({
    mutationFn: async (): Promise<({ single: One } | { many: ManyRow[] }) & { asked: Asked }> => {
      // The question as asked: the pickers may change afterwards, the answer (and its export) must not
      const asked: Asked = {
        action, actors: actorIds, target, changes,
        ...(isGroup ? { sgid: Number(sgid) } : {}),
        ...(action === 'move' ? { destination: Number(destination) } : {}),
        ...(action === 'ban' ? { duration } : {}),
      };
      if (!multi) return { single: await askOne(actor), asked };
      // Two at a time: each answer costs its own read commands on the server
      const rows: ManyRow[] = actors.map((a) => ({ actor: a }));
      for (let i = 0; i < rows.length; i += 2) {
        await Promise.all(rows.slice(i, i + 2).map(async (r) => {
          try { r.data = await askOne(r.actor); } catch (err) { r.error = err; }
        }));
      }
      return { many: rows, asked };
    },
    onMutate: () => setDetail(null),
  });
  const updateChanges = (next: WhatIfChange[]) => { setChanges(next); explain.reset(); };
  const toggleMulti = (on: boolean) => {
    setMulti(on);
    if (on) setActors(actor ? [actor] : []); else setActor(actors[0] ?? '');
    explain.reset();
  };
  const toggleActor = (id: string) => setActors((list) =>
    list.includes(id) ? list.filter((x) => x !== id) : list.length < WHY_MAX_ACTORS ? [...list, id] : list);
  const [fromEditor, setFromEditor] = useState(false);
  useEffect(() => {
    if (!prefill) return;
    setChanges(prefill.changes);
    if (prefill.actor) { setActor(prefill.actor); setActors([prefill.actor]); setTarget((t0) => (t0 === prefill.actor ? '' : t0)); }
    if (prefill.target) { setTarget(prefill.target); setActor((a0) => (a0 === prefill.target ? '' : a0)); }
    setFromEditor(true);
    explain.reset();
  }, [prefill?.seq]); // only a new hand-over (seq) applies it, not every re-render

  const nameOf = (cldbid: number | string) => clients.find((c) => c.id === String(cldbid))?.name ?? t('pages.permissions.clientFallback', { id: cldbid });
  const channelName = (cid: number | string | null) => channels.find((ch) => ch.cid === String(cid))?.name ?? t('pages.permissions.channelFallback', { id: cid });
  const groupName = (id: number | string | null) => serverGroups.find((g) => g.sgid === String(id))?.name ?? t('pages.permissions.serverGroupFallback', { id });
  const cgName = (id: number | string) => channelGroups.find((g) => g.cgid === String(id))?.name ?? t('pages.permissions.channelGroupFallback', { id });

  const whoName = (w: WhatIfWho) => {
    if (w === 'actor' && multi) return t('pages.permissions.why.multi.eachActor');
    const id = w === 'actor' ? actor : target;
    return id ? nameOf(id) : t(`pages.permissions.why.${w}`);
  };
  const describeChange = (c: WhatIfChange): string => {
    const val = (v: { permvalue: number; permnegated?: boolean; permskip?: boolean } | null) => v === null ? ''
      : `${v.permvalue}${v.permnegated ? ' (N)' : ''}${v.permskip ? ' (S)' : ''}`;
    const d = (k: string, o: Record<string, unknown>) => t(`pages.permissions.why.whatif.describe.${k}`, o);
    if (c.kind === 'group-member') return d(c.op, { client: whoName(c.who), group: groupName(c.sgid) });
    if (c.kind === 'channel-group-member') return d('cg-assign', { client: whoName(c.who), group: cgName(c.cgid), channel: channelName(c.cid) });
    const key = c.value === null ? 'unset' : 'set';
    const common = { perm: c.permsid, value: val(c.value) };
    switch (c.kind) {
      case 'group-perm': return d(`group-${key}`, { group: groupName(c.sgid), ...common });
      case 'client-perm': return d(`client-${key}`, { client: whoName(c.who), ...common });
      case 'channel-group-perm': return d(`cg-${key}`, { group: cgName(c.cgid), ...common });
      case 'channel-perm': return d(`ch-${key}`, { channel: channelName(c.cid), ...common });
      case 'channel-client-perm': return d(`cc-${key}`, { client: whoName(c.who), channel: channelName(c.cid), ...common });
    }
  };
  // R13: a temporary membership only gets a hint, it does not change the calculation (decision 5)
  const mayMembers = useAuthStore((s) => s.can('groups.members'));
  const temps = useTemporaryGroups('open', mayMembers && changes.some((c) => c.kind === 'group-member'));
  const tempUntil = (c: WhatIfChange): string | null => {
    if (c.kind !== 'group-member' || c.op !== 'remove') return null;
    const ids = (c.who === 'actor' ? actorIds : [target]).map(Number);
    const hit = (temps.data ?? []).find((e) => e.sgid === c.sgid && ids.includes(e.cldbid));
    return hit ? new Date(hit.expiresAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  };

  const errorText = (err: any): string => {
    const code = err?.response?.data?.code;
    if (typeof code === 'string' && ['actor-not-found', 'target-not-found', 'group-not-found', 'destination-not-found'].includes(code)) {
      return t(`pages.permissions.why.error.${code}`);
    }
    if (typeof code === 'string' && code.startsWith('whatif-')) {
      const n = /change (\d+)/i.exec(String(err.response.data.error ?? ''))?.[1];
      return t(`pages.permissions.why.whatif.error.${code.slice(7)}`, { n: n ?? '?', defaultValue: t('pages.permissions.why.error.generic') });
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

  const verdictText = (v: string) => t(`pages.permissions.why.verdict.${v}`);
  const wrapOf = (w: WhatIfExplainResult) => (v: PermissionVerdict<ExplainRow>): ExplainResult => ({ ...v, context: w.context });
  const whatifSummary = (w: WhatIfExplainResult) => {
    const changed = w.before.verdict !== w.after.verdict;
    const headline = changed
      ? t('pages.permissions.why.whatif.verdictChanged', { before: verdictText(w.before.verdict), after: verdictText(w.after.verdict) })
      : t('pages.permissions.why.whatif.verdictSame', { verdict: verdictText(w.after.verdict) });
    const groupLines = (['actor', 'target'] as const)
      .filter((who) => w.groups[who].before.join() !== w.groups[who].after.join())
      .map((who) => t('pages.permissions.why.whatif.groupsChange', {
        client: nameOf(w.context[who].cldbid),
        before: w.groups[who].before.map(groupName).join(', '),
        after: w.groups[who].after.map(groupName).join(', '),
      }))
      .concat((w.channelGroups ?? []).map((g) => t('pages.permissions.why.whatif.channelGroupChange', {
        client: nameOf(w.context[g.who].cldbid), channel: channelName(g.cid), before: cgName(g.before), after: cgName(g.after),
      })))
      .concat((w.unused ?? []).map((i) => t('pages.permissions.why.whatif.unused', { n: i + 1 })));
    return { changed, headline, groupLines };
  };

  // Stage 4c: the answer as text or as a JSON file, built in the browser from what was answered (no extra request)
  const answerLines = (r: ExplainResult): string[] => {
    const x = explainTexts(r, t, nameOf, channelName, groupName);
    const src = (row: ExplainRow | null, scope: string) => {
      const s = row ? describeSource(row) : null;
      const where = s ? `${s.tierLabel}: ${s.name}${row!.permnegated ? ' (N)' : ''}${row!.permskip ? ' (S)' : ''}` : t('pages.permissions.why.notSet');
      return `${where} · ${x.scopeText(scope)}`;
    };
    return [
      `${verdictText(r.verdict)}: ${x.actor} → ${t(`pages.permissions.why.actions.${r.action}`)} → ${x.target}`,
      ...r.notes.map((n) => `  i ${x.noteText(n)}`),
      ...r.checks.flatMap((c) => [
        `  ${c.ok ? '✓' : '✗'} ${x.checkText(c)}`,
        `      ${c.have.permission} = ${x.value(c.have.value, c.have.permission)} – ${src(c.have.source, c.have.scope)}`,
        ...(!c.need ? [] : [`      ${c.need.permission} = ${c.need.value} – ${c.need.scope === 'group'
          ? `${t('pages.permissions.why.groupSetting')}: ${groupName((c.need as { sgid: number }).sgid)}`
          : src(c.need.source as ExplainRow | null, c.need.scope)}`]),
      ]),
    ];
  };
  const oneLines = (d: One): string[] => {
    if ('plain' in d) return answerLines(d.plain);
    const { headline, groupLines } = whatifSummary(d.whatif);
    const wrap = wrapOf(d.whatif);
    return [headline, ...groupLines, '',
      `${t('pages.permissions.why.whatif.before')}:`, ...answerLines(wrap(d.whatif.before)), '',
      `${t('pages.permissions.why.whatif.after')}:`, ...answerLines(wrap(d.whatif.after))];
  };
  const exportText = (data: NonNullable<typeof explain.data>): string => {
    const { asked } = data;
    const lines = [`${t('pages.permissions.why.title')} – ${new Date().toLocaleString(i18n.language)}`];
    if (asked.changes.length > 0) {
      lines.push('', `${t('pages.permissions.why.whatif.planned')}:`, ...asked.changes.map((c, i) => `  ${i + 1}. ${describeChange(c)}`), t('pages.permissions.why.whatif.nothingChanged'));
    }
    lines.push('');
    if ('single' in data) return [...lines, ...oneLines(data.single)].join('\n');
    const planned = asked.changes.length > 0;
    const v = (d: One, side: 'before' | 'after') => verdictText('plain' in d ? d.plain.verdict : d.whatif[side].verdict);
    lines.push(t('pages.permissions.why.multi.title', { action: t(`pages.permissions.why.actions.${asked.action}`), target: nameOf(asked.target) }));
    for (const r of data.many) {
      lines.push(`  ${nameOf(r.actor)}: ${!r.data ? errorText(r.error) : planned ? `${v(r.data, 'before')} → ${v(r.data, 'after')}` : v(r.data, 'before')}`);
    }
    for (const r of data.many) if (r.data) lines.push('', `${t('pages.permissions.why.multi.details')} – ${nameOf(r.actor)}`, ...oneLines(r.data));
    return lines.join('\n');
  };
  const exportJson = (data: NonNullable<typeof explain.data>) => {
    const { asked } = data;
    const rows: ManyRow[] = 'single' in data ? [{ actor: asked.actors[0], data: data.single }] : data.many;
    const client = (id: string) => ({ cldbid: Number(id), name: nameOf(id) });
    const json = {
      format: 'ts6-manager-why', version: 1, exportedAt: new Date().toISOString(), sid,
      question: { action: asked.action, target: client(asked.target), sgid: asked.sgid, destination: asked.destination, duration: asked.duration },
      changes: asked.changes,
      answers: rows.map((r) => ({
        actor: client(r.actor),
        ...(!r.data ? { error: errorText(r.error) } : 'plain' in r.data ? { result: r.data.plain } : { whatif: r.data.whatif }),
      })),
    };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadTextFile(`why-${asked.action}-${stamp}.json`, JSON.stringify(json, null, 2), 'application/json');
  };
  const copyText = (text: string) => {
    // The browser only offers the clipboard on https and on localhost
    const failed = () => toast.error(t('pages.console.result.copyFailed'));
    if (!navigator.clipboard) return failed();
    navigator.clipboard.writeText(text).then(() => toast.success(t('common.copied')), failed);
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
            <div className="space-y-2 min-w-0">
              <ClientField id="why-actor" label={multi ? t('pages.permissions.why.multi.actors') : t('pages.permissions.why.actor')} clients={clients} loading={clientsLoading}
                value={multi ? actors : actor} onChange={multi ? toggleActor : setActor} />
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={multi} onCheckedChange={(v) => toggleMulti(!!v)} />
                {t('pages.permissions.why.multi.toggle', { max: WHY_MAX_ACTORS })}
              </label>
            </div>
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
                {changes.length > 0 ? t('pages.permissions.why.whatif.check', { count: changes.length }) : t('pages.permissions.why.check')}
              </Button>
              {missing && <p className="text-[11px] text-muted-foreground">{t(`pages.permissions.why.missing.${missing}`)}</p>}
            </div>
            <ClientField id="why-target" label={t('pages.permissions.why.target')} clients={clients} loading={clientsLoading} value={target} onChange={setTarget} />
          </div>
          {fromEditor && changes.length > 0 && (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground" role="note">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />{t('pages.permissions.why.whatif.fromEditor.note')}
            </p>
          )}
          <WhatIfEditor changes={changes} onChange={updateChanges} serverGroups={serverGroups} channelGroups={channelGroups} channels={channels} permissions={permissions}
            describe={describeChange} tempUntil={tempUntil} />
        </CardContent>
      </Card>

      {explain.isPending && <div className="flex justify-center py-8"><PageLoader /></div>}
      {explain.isError && (
        <Card className="card-hero border-destructive/40"><CardContent className="py-4 text-sm text-destructive" role="alert">{errorText(explain.error)}</CardContent></Card>
      )}
      {explain.data && !explain.isPending && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copyText(exportText(explain.data!))}>
            <Copy className="h-3.5 w-3.5 mr-1" aria-hidden />{t('pages.permissions.why.export.copy')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => exportJson(explain.data!)}>
            <Download className="h-3.5 w-3.5 mr-1" aria-hidden />{t('pages.permissions.why.export.json')}
          </Button>
        </div>
      )}
      {explain.data && !explain.isPending && 'single' in explain.data && renderOne(explain.data.single)}
      {explain.data && !explain.isPending && 'many' in explain.data && (() => {
        const rows = explain.data.many;
        const planned = explain.data.asked.changes.length > 0;
        const verdictOf = (d: One, side: 'before' | 'after') => ('plain' in d ? d.plain.verdict : d.whatif[side].verdict);
        const tone = (v: string) => (v === 'allowed' ? 'text-emerald-500' : v === 'denied' ? 'text-destructive' : 'text-amber-500');
        const cell = (v: string) => <span className={cn('font-medium', tone(v))}>{t(`pages.permissions.why.verdict.${v}`)}</span>;
        const open = rows.find((r) => r.actor === detail && r.data);
        return (
          <div className="space-y-3">
            <Card className="card-hero">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('pages.permissions.why.multi.title', { action: t(`pages.permissions.why.actions.${explain.data.asked.action}`), target: nameOf(explain.data.asked.target) })}
                </CardTitle>
                {planned && <p className="text-[11px] text-muted-foreground pt-1">{t('pages.permissions.why.whatif.nothingChanged')}</p>}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border/50">
                      <th scope="col" className="py-1.5 pr-3 font-medium">{t('pages.permissions.why.actor')}</th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">{planned ? t('pages.permissions.why.whatif.before') : t('pages.permissions.why.multi.answer')}</th>
                      {planned && <th scope="col" className="py-1.5 pr-3 font-medium">{t('pages.permissions.why.whatif.after')}</th>}
                      <th scope="col" className="py-1.5"><span className="sr-only">{t('pages.permissions.why.multi.details')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const changed = r.data && planned && verdictOf(r.data, 'before') !== verdictOf(r.data, 'after');
                      return (
                        <tr key={r.actor} className={cn('border-b border-border/30', changed && 'bg-primary/5', detail === r.actor && 'outline outline-1 outline-primary/40')}>
                          <th scope="row" className="py-1.5 pr-3 font-normal text-left">{nameOf(r.actor)}</th>
                          {r.data ? (
                            <>
                              <td className="py-1.5 pr-3">{cell(verdictOf(r.data, 'before'))}</td>
                              {planned && <td className="py-1.5 pr-3">{cell(verdictOf(r.data, 'after'))}{changed && <span className="sr-only"> ({t('pages.permissions.why.multi.changed')})</span>}</td>}
                              <td className="py-1.5 text-right">
                                <Button variant="ghost" size="sm" className="h-6 text-xs" aria-pressed={detail === r.actor}
                                  onClick={() => setDetail(detail === r.actor ? null : r.actor)}>
                                  {t('pages.permissions.why.multi.details')}
                                </Button>
                              </td>
                            </>
                          ) : (
                            <td colSpan={planned ? 3 : 2} className="py-1.5 text-destructive">{errorText(r.error)}</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            {open?.data && renderOne(open.data)}
          </div>
        );
      })()}
    </div>
  );

  function renderOne(data: One) {
    if ('plain' in data) {
      return (
        <Result
          result={data.plain}
          nameOf={nameOf} channelName={channelName} groupName={groupName}
          describeSource={describeSource} permDesc={permDesc} onJump={onJump} onShowOverview={onShowOverview}
        />
      );
    }
    return (() => {
        const w = data.whatif;
        const wrap = wrapOf(w);
        const { changed, headline, groupLines } = whatifSummary(w);
        return (
          <div className="space-y-3">
            <div role="status" className={cn('rounded-md border p-3 text-xs space-y-1', changed ? 'border-primary/50 bg-primary/5' : 'border-border/50')}>
              <p className="flex items-center gap-2 font-medium">
                <FlaskConical className="h-4 w-4 text-primary" aria-hidden />{t('pages.permissions.why.whatif.nothingChanged')}
              </p>
              <p>{headline}</p>
              {groupLines.map((l) => <p key={l} className="text-muted-foreground">{l}</p>)}
            </div>
            <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
              <Result heading={t('pages.permissions.why.whatif.before')} result={wrap(w.before)}
                nameOf={nameOf} channelName={channelName} groupName={groupName}
                describeSource={describeSource} permDesc={permDesc} onJump={onJump} onShowOverview={onShowOverview} />
              <Result heading={t('pages.permissions.why.whatif.after')} preview result={wrap(w.after)}
                nameOf={nameOf} channelName={channelName} groupName={groupName}
                describeSource={describeSource} permDesc={permDesc} onJump={onJump} onShowOverview={onShowOverview} />
            </div>
          </div>
        );
      })();
  }
}

/** The wording of one answer, shared by the result card and the text export so both say the same. */
function explainTexts(result: ExplainResult, t: TFunction, nameOf: (id: number | string) => string,
  channelName: (cid: number | string | null) => string, groupName: (id: number | string | null) => string) {
  const ctx = result.context;
  const actor = nameOf(ctx.actor.cldbid);
  const target = nameOf(ctx.target.cldbid);
  const scopeCid = (scope: string) => scope === 'target-channel' ? ctx.target.cid : scope === 'destination' ? ctx.destination : ctx.actor.cid;
  const scopeText = (scope: string): string => {
    if (scope === 'group') return t('pages.permissions.why.scope.group', { group: groupName(ctx.sgid) });
    if (scope === 'server') return t('pages.permissions.why.scope.server');
    return t(`pages.permissions.why.scope.${scope}`, { actor, target, channel: channelName(scopeCid(scope)) });
  };
  const value = (v: number, permsid: string) => permsid.startsWith('b_') ? (v >= 1 ? t('pages.permissions.why.yes') : t('pages.permissions.why.no')) : String(v);
  const checkText = (c: PermissionCheck<ExplainRow>) => t(`pages.permissions.why.checkText.${c.kind === 'ban-time' && c.duration === 0 ? 'ban-time-permanent' : c.kind}`, {
    actor, have: value(c.have.value, c.have.permission), need: c.need ? value(c.need.value, c.need.permission) : '',
    duration: c.duration === 0 ? t('pages.permissions.why.durations.permanent') : t('pages.permissions.why.seconds', { count: c.duration ?? 0 }),
  });
  const noteText = (n: string) => t(`pages.permissions.why.notes.${n}`, { actor, target, channel: channelName(ctx.defaultCid), group: groupName(ctx.sgid) });
  return { actor, target, scopeCid, scopeText, value, checkText, noteText };
}

function Result({ result, heading, preview, nameOf, channelName, groupName, describeSource, permDesc, onJump, onShowOverview }: {
  result: ExplainResult;
  /** "Before" / "after" in a what-if comparison. */
  heading?: string;
  /** The planned state: no overview link and no fix suggestion (both would point at today's rights). */
  preview?: boolean;
  nameOf: (id: number | string) => string;
  channelName: (cid: number | string | null) => string;
  groupName: (id: number | string | null) => string;
} & Pick<Props, 'describeSource' | 'permDesc' | 'onJump' | 'onShowOverview'>) {
  const { t } = useTranslation();
  const { context: ctx } = result;
  const { actor, target, scopeCid, scopeText, value, checkText, noteText } = explainTexts(result, t, nameOf, channelName, groupName);
  const tone = result.verdict === 'allowed' ? 'text-emerald-500' : result.verdict === 'denied' ? 'text-destructive' : 'text-amber-500';
  const Icon = result.verdict === 'allowed' ? Check : result.verdict === 'denied' ? X : Ban;

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
        {heading && <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{heading}</p>}
        <div className="flex flex-wrap items-center gap-3" role={heading ? undefined : 'status'}>
          <Icon className={cn('h-6 w-6', tone)} aria-hidden />
          <div>
            <p className={cn('text-base font-semibold', tone)}>{t(`pages.permissions.why.verdict.${result.verdict}`)}</p>
            <p className="text-xs text-muted-foreground">
              {actor} <ArrowRight className="inline h-3 w-3" aria-hidden /> {t(`pages.permissions.why.actions.${result.action}`)} <ArrowRight className="inline h-3 w-3" aria-hidden /> {target}
            </p>
          </div>
          {!preview && (
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => onShowOverview(String(ctx.actor.cldbid), String(ctx.target.online ? ctx.target.cid : ctx.actor.cid))}>
              <Layers className="h-3.5 w-3.5 mr-1" /> {t('pages.permissions.why.showOverview', { name: actor })}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.notes.length > 0 && (
          <ul className="space-y-1">
            {result.notes.map((n) => (
              <li key={n} className="flex gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
                <span>{noteText(n)}</span>
              </li>
            ))}
          </ul>
        )}
        {result.checks.map((c, i) => {
          const fix = result.verdict === 'impossible' || preview ? null : fixFor(c);
          return (
            <div key={i} className={cn('rounded-md border p-3 space-y-2', c.ok ? 'border-border/50' : 'border-destructive/40')}>
              <div className="flex items-start gap-2">
                {c.ok ? <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" aria-label={t('pages.permissions.why.checkOk')} />
                  : <X className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-label={t('pages.permissions.why.checkFailed')} />}
                <p className="text-xs">{checkText(c)}</p>
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
