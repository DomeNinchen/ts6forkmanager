import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { SNAPSHOT_RESET_EXCLUDED_FIELDS } from '@ts6/common';
import type { SnapshotBackupSource, SnapshotCompareResult, SnapshotCompareSource, SnapshotObjectDiff, SnapshotObjectKind, SnapshotPermValue, SnapshotResetChoice } from '@ts6/common';
import { serversApi } from '@/api/servers.api';
import { useServerStore } from '@/stores/server.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/EmptyState';
import { Pager } from '@/components/connection-journal/table-parts';
import { ArrowLeft, GitCompare, RotateCcw, Search, Undo2, Upload } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { RestoreGroupsDialog, type RestoreTarget } from '@/components/snapshot/RestoreGroupsDialog';
import { ResetDialog } from '@/components/snapshot/ResetDialog';

const PAGE_SIZE = 25;
const KINDS: SnapshotObjectKind[] = ['serverGroup', 'channelGroup', 'channel'];

function errorText(err: any, fallback: string): string {
  return err?.response?.data?.details || err?.response?.data?.error || fallback;
}

type SideType = 'backup' | 'file' | 'live';
interface Side {
  type: SideType;
  backup: string;
  file: { name: string; snapshot: { version: string | number; data: string } } | null;
  fileError: string | null;
}

export default function SnapshotCompare() {
  const { t, i18n } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const [params] = useSearchParams();
  // ?backup=<kind>/<name> (from the Backups page) puts that backup on the "before" side.
  const [before, setBefore] = useState<Side>({ type: 'backup', backup: params.get('backup') ?? '', file: null, fileError: null });
  const [after, setAfter] = useState<Side>({ type: 'live', backup: '', file: null, fileError: null });
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | SnapshotObjectKind>('all');
  const [page, setPage] = useState(1);
  // The column headings of the result, fixed when it was asked for.
  const [labels, setLabels] = useState<[string, string]>(['', '']);
  // The sides of the result shown: restoring takes groups from its "before" snapshot into the live server.
  const [ran, setRan] = useState<{ source: SnapshotCompareSource; against: SnapshotCompareSource } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState<RestoreTarget[] | null>(null);
  // Rows of objects that still exist, ticked to be set back: `${kind}:${id}:${perm|field}:${key}`.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [resetting, setResetting] = useState<SnapshotResetChoice[] | null>(null);

  const sources = useQuery({
    queryKey: ['snapshot-compare-sources', selectedConfigId, selectedSid],
    queryFn: () => serversApi.snapshotCompareSources(selectedConfigId!, selectedSid!),
    enabled: !!selectedConfigId && !!selectedSid,
  });

  const compare = useMutation({
    mutationFn: (body: { source: SnapshotCompareSource; against: SnapshotCompareSource }) => serversApi.compareSnapshot(selectedConfigId!, selectedSid!, body),
    onSuccess: () => setPage(1),
  });

  // From a "deleted" notice: ?backup=…&select=kind:id,… compares that backup with the server at once
  // and ticks the deleted objects that are still missing.
  const autoRan = useRef(false);
  useEffect(() => {
    const select = params.get('select');
    const b = sources.data?.find((s) => `${s.kind}/${s.name}` === params.get('backup'));
    if (autoRan.current || !select || !b) return;
    autoRan.current = true;
    const body = { source: { type: 'backup' as const, kind: b.kind, name: b.name }, against: { type: 'live' as const } };
    setLabels([t('pages.snapshotCompare.backupLabel', { time: new Date(b.createdAt).toLocaleString(i18n.language) }), t('pages.snapshotCompare.liveNow')]);
    setRan(body);
    compare.mutate(body, {
      onSuccess: (r) => setSelected(new Set(select.split(',').filter((k) => r.objects.some((o) => o.status === 'removed' && `${o.kind}:${o.id}` === k)))),
    });
  }, [sources.data, params, compare, t, i18n.language]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (compare.data?.objects ?? []).filter((o) => (kind === 'all' || o.kind === kind) && (!q
      || o.name.toLowerCase().includes(q) || String(o.id) === q
      || o.perms.some((p) => p.perm.includes(q)) || o.fields.some((f) => f.field.includes(q))));
  }, [compare.data, search, kind]);

  if (!selectedConfigId || !selectedSid) {
    return <EmptyState icon={GitCompare} title={t('pages.noServerSelected')} description={t('pages.serverStats.selectServerFirst')} />;
  }

  const date = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const backupOf = (side: Side) => sources.data?.find((s) => `${s.kind}/${s.name}` === side.backup);
  const sourceOf = (side: Side): SnapshotCompareSource | null => {
    if (side.type === 'live') return { type: 'live' };
    if (side.type === 'file') return side.file ? { type: 'file', snapshot: side.file.snapshot } : null;
    const b = backupOf(side);
    return b ? { type: 'backup', kind: b.kind, name: b.name } : null;
  };
  const labelOf = (side: Side): string => side.type === 'live' ? t('pages.snapshotCompare.liveNow')
    : side.type === 'file' ? t('pages.snapshotCompare.fileLabel', { name: side.file?.name ?? '' })
    : t('pages.snapshotCompare.backupLabel', { time: backupOf(side) ? date(backupOf(side)!.createdAt) : '' });

  const source = sourceOf(before);
  const against = sourceOf(after);
  const run = () => {
    if (!source || !against) return;
    setLabels([labelOf(before), labelOf(after)]);
    setRan({ source, against });
    setSelected(new Set());
    setPicked(new Set());
    compare.mutate({ source, against });
  };
  // Groups that are only in the snapshot, compared with the live server: these can be brought back.
  const canRestore = (o: SnapshotObjectDiff) => ran?.against.type === 'live' && ran.source.type !== 'live' && o.status === 'removed';
  const keyOf = (o: { kind: string; id: number }) => `${o.kind}:${o.id}`;
  const toggle = (o: SnapshotObjectDiff) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(keyOf(o))) next.delete(keyOf(o)); else next.add(keyOf(o));
    return next;
  });
  // Objects that still exist and differ: single rows can be set back.
  const canReset = (o: SnapshotObjectDiff) => ran?.against.type === 'live' && ran.source.type !== 'live' && o.status === 'changed';
  const togglePick = (key: string) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const openReset = () => {
    const byObject = new Map<string, SnapshotResetChoice>();
    for (const key of picked) {
      const [k, id, item, ...rest] = key.split(':');
      const name = rest.join(':');
      const choice = byObject.get(`${k}:${id}`) ?? { kind: k as SnapshotObjectKind, id: Number(id), perms: [], fields: [] };
      (item === 'perm' ? choice.perms! : choice.fields!).push(name);
      byObject.set(`${k}:${id}`, choice);
    }
    setResetting([...byObject.values()]);
  };
  const openRestore = () => setRestoring((compare.data?.objects ?? []).filter((o) => canRestore(o) && selected.has(keyOf(o)))
    .map((o): RestoreTarget => ({ kind: o.kind, id: o.id })));
  // A backup named in the link that this virtual server's list does not have (another server selected).
  const linkedMissing = before.type === 'backup' && !!before.backup && !!sources.data && !backupOf(before);

  const result: SnapshotCompareResult | undefined = compare.data;
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pickerProps = { backups: sources.data, date };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          {params.get('backup')
            ? <Link to="/backups"><ArrowLeft className="h-4 w-4 mr-1" /> {t('nav.items.backups')}</Link>
            : <Link to="/miscellaneous"><ArrowLeft className="h-4 w-4 mr-1" /> {t('nav.items.miscellaneous')}</Link>}
        </Button>
        <h1 className="text-xl font-semibold">{t('pages.snapshotCompare.title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl">{t('pages.snapshotCompare.description')}</p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('pages.snapshotCompare.whatToCompare')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SidePicker id="snapshot" title={t('pages.snapshotCompare.sideBefore')} side={before} onChange={setBefore} {...pickerProps} />
          {linkedMissing && <p className="text-xs text-destructive" role="alert">{t('pages.snapshotCompare.linkedMissing')}</p>}
          <SidePicker id="snapshot-against" title={t('pages.snapshotCompare.sideAfter')} side={after} onChange={setAfter} allowLive {...pickerProps} />
          {(before.type === 'backup' || after.type === 'backup') && sources.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('pages.snapshotCompare.noBackups')}</p>
          )}
          <Button onClick={run} disabled={!source || !against || compare.isPending} data-testid="snapshot-compare-run">
            <GitCompare className="h-4 w-4 mr-1" /> {compare.isPending ? t('pages.snapshotCompare.comparing') : t('pages.snapshotCompare.compare')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('pages.snapshotCompare.scope')}</p>
        </CardContent>
      </Card>

      {compare.isError && (
        <p className="text-sm text-destructive" role="alert" data-testid="snapshot-compare-error">{errorText(compare.error, t('pages.snapshotCompare.failed'))}</p>
      )}

      {result && (
        <div className="space-y-3" data-testid="snapshot-compare-result">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {KINDS.map((k) => (
              <Card key={k}>
                <CardContent className="p-3 text-sm">
                  <div className="font-medium">{t(`pages.snapshotCompare.kinds.${k}`)}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('pages.snapshotCompare.countLine', { ...result.counts[k] })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {result.objects.length === 0 ? (
            <p className="text-sm" data-testid="snapshot-compare-empty">{t('pages.snapshotCompare.noDifferences')}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input className="pl-8" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder={t('pages.snapshotCompare.searchPlaceholder')} aria-label={t('pages.snapshotCompare.searchPlaceholder')} />
                </div>
                <Select value={kind} onValueChange={(v) => { setKind(v as typeof kind); setPage(1); }}>
                  <SelectTrigger className="w-[200px]" aria-label={t('pages.snapshotCompare.kindFilter')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('pages.snapshotCompare.allKinds')}</SelectItem>
                    {KINDS.map((k) => <SelectItem key={k} value={k}>{t(`pages.snapshotCompare.kinds.${k}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {result.objects.some(canRestore) && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2 text-sm" data-testid="restore-bar">
                  <span className="text-muted-foreground">{t('pages.snapshotCompare.restore.hint')}</span>
                  <Button size="sm" onClick={openRestore} disabled={selected.size === 0} data-testid="restore-open">
                    <RotateCcw className="h-4 w-4 mr-1" /> {t('pages.snapshotCompare.restore.open', { count: selected.size })}
                  </Button>
                </div>
              )}
              {result.objects.some(canReset) && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2 text-sm" data-testid="reset-bar">
                  <span className="text-muted-foreground">{t('pages.snapshotCompare.reset.hint')}</span>
                  <Button size="sm" onClick={openReset} disabled={picked.size === 0} data-testid="reset-open">
                    <Undo2 className="h-4 w-4 mr-1" /> {t('pages.snapshotCompare.reset.open', { count: picked.size })}
                  </Button>
                </div>
              )}
              {shown.map((o) => (
                <ObjectDiff key={`${o.kind}-${o.id}`} o={o} labels={labels}
                  select={canRestore(o) ? { checked: selected.has(keyOf(o)), onChange: () => toggle(o) } : undefined}
                  pick={canReset(o) ? { has: (item, key) => picked.has(`${keyOf(o)}:${item}:${key}`), toggle: (item, key) => togglePick(`${keyOf(o)}:${item}:${key}`) } : undefined} />
              ))}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground">{t('pages.snapshotCompare.noMatch')}</p>}
              <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage}
                countText={t('pages.snapshotCompare.objectCount', { count: filtered.length })} />
            </>
          )}
        </div>
      )}

      {resetting && ran && (
        <ResetDialog configId={selectedConfigId} sid={selectedSid} source={ran.source} items={resetting}
          onClose={(changed) => {
            setResetting(null);
            if (changed) { setPicked(new Set()); compare.mutate(ran); }
          }} />
      )}

      {restoring && ran && (
        <RestoreGroupsDialog configId={selectedConfigId} sid={selectedSid} source={ran.source} targets={restoring}
          onClose={(changed) => {
            setRestoring(null);
            // Show the server as it is now: restored groups are no longer "removed".
            if (changed) { setSelected(new Set()); compare.mutate(ran); }
          }} />
      )}
    </div>
  );
}

const STATUS_VARIANT = { added: 'success', removed: 'destructive', changed: 'warning' } as const;

function ObjectDiff({ o, labels, select, pick }: {
  o: SnapshotObjectDiff;
  labels: [string, string];
  select?: { checked: boolean; onChange: () => void };
  /** An object that still exists: its rows can be ticked to set them back to the snapshot. */
  pick?: { has: (item: 'perm' | 'field', key: string) => boolean; toggle: (item: 'perm' | 'field', key: string) => void };
}) {
  const { t } = useTranslation();
  const rowPick = (item: 'perm' | 'field', key: string, label: string): RowPick =>
    pick && !(item === 'field' && SNAPSHOT_RESET_EXCLUDED_FIELDS.includes(key))
      ? { checked: pick.has(item, key), onChange: () => pick.toggle(item, key), label: t('pages.snapshotCompare.reset.select', { name: label }) }
      : null;
  const fieldLabel = (f: string) => t(`pages.snapshotCompare.fields.${f}`, { defaultValue: f });
  const value = (field: string, v: string | null) => (v === null ? '—' : v !== '' ? v
    : t(field === 'parent' ? 'pages.snapshotCompare.topLevel' : field === 'below' ? 'pages.snapshotCompare.first' : 'pages.snapshotCompare.empty'));
  const perm = (p: SnapshotPermValue | null) => {
    if (!p) return '—';
    const flags = [p.negated && t('pages.snapshotCompare.negated'), p.skip && t('pages.snapshotCompare.skip')].filter(Boolean);
    return flags.length ? `${p.value} (${flags.join(', ')})` : String(p.value);
  };
  // A new or removed group lists all of its permissions: folded away unless opened.
  const foldPerms = o.status !== 'changed' && o.perms.length > 0;
  const permTable = (
    <DiffTable head={t('pages.snapshotCompare.permission')} labels={labels} rows={o.perms.map((p) => [p.perm, perm(p.before), perm(p.after)])}
      picks={pick ? o.perms.map((p) => rowPick('perm', p.perm, p.perm)) : undefined} mono />
  );
  return (
    <Card data-testid="snapshot-compare-object">
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {select && (
            <Checkbox checked={select.checked} onCheckedChange={select.onChange} data-testid="restore-select"
              aria-label={t('pages.snapshotCompare.restore.select', { name: o.name })} />
          )}
          <Badge variant={STATUS_VARIANT[o.status]}>{t(`pages.snapshotCompare.status.${o.status}`)}</Badge>
          <span className="text-xs text-muted-foreground">{t(`pages.snapshotCompare.kinds.${o.kind}`)}</span>
          <span className="font-medium break-all">{o.name}</span>
          <span className="text-xs text-muted-foreground">#{o.id}</span>
        </div>
        {o.fields.length > 0 && (
          <DiffTable head={t('pages.snapshotCompare.field')} labels={labels} rows={o.fields.map((f) => [fieldLabel(f.field), value(f.field, f.before), value(f.field, f.after)])}
            picks={pick ? o.fields.map((f) => rowPick('field', f.field, fieldLabel(f.field))) : undefined} />
        )}
        {foldPerms ? (
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">{t('pages.snapshotCompare.permissionCount', { count: o.perms.length })}</summary>
            <div className="mt-2">{permTable}</div>
          </details>
        ) : o.perms.length > 0 && permTable}
      </CardContent>
    </Card>
  );
}

/** One side of the comparison: a backup or a file, and on the "after" side also the server as it is now. */
function SidePicker({ id, title, side, onChange, allowLive, backups, date }: {
  id: string;
  title: string;
  side: Side;
  onChange: (s: Side) => void;
  allowLive?: boolean;
  backups: SnapshotBackupSource[] | undefined;
  date: (iso: string) => string;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (typeof json?.data !== 'string' || json.version === undefined) throw new Error();
      onChange({ ...side, file: { name: f.name, snapshot: { version: json.version, data: json.data } }, fileError: null });
    } catch {
      onChange({ ...side, file: null, fileError: t('pages.misc.notValidSnapshot') });
    }
  };
  return (
    <fieldset className="space-y-1" data-testid={`${id}-side`}>
      <legend className="text-xs font-medium text-muted-foreground mb-1">{title}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1 w-full sm:w-auto">
          <Label htmlFor={`${id}-source-type`}>{t('pages.snapshotCompare.sourceType')}</Label>
          <Select value={side.type} onValueChange={(v) => onChange({ ...side, type: v as SideType })}>
            <SelectTrigger id={`${id}-source-type`} className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowLive && <SelectItem value="live">{t('pages.snapshotCompare.fromLive')}</SelectItem>}
              <SelectItem value="backup">{t('pages.snapshotCompare.fromBackup')}</SelectItem>
              <SelectItem value="file">{t('pages.snapshotCompare.fromFile')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {side.type === 'backup' && (
          <div className="space-y-1 w-full sm:w-auto">
            <Label htmlFor={`${id}-backup`}>{t('pages.snapshotCompare.backup')}</Label>
            <Select value={side.backup} onValueChange={(v) => onChange({ ...side, backup: v })} disabled={!backups?.length}>
              <SelectTrigger id={`${id}-backup`} className="w-full sm:w-[340px]"><SelectValue placeholder={t('pages.snapshotCompare.pickBackup')} /></SelectTrigger>
              <SelectContent>
                {backups?.map((s) => (
                  <SelectItem key={`${s.kind}/${s.name}`} value={`${s.kind}/${s.name}`}>
                    {date(s.createdAt)} · {t(`pages.backups.kind.${s.kind}`, { defaultValue: s.kind })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {side.type === 'file' && (
          <div className="space-y-1">
            <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid={`${id}-file`}>
              <Upload className="h-4 w-4 mr-1" /> {side.file ? side.file.name : t('pages.snapshotCompare.pickFile')}
            </Button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pickFile} />
          </div>
        )}
      </div>
      {side.type === 'file' && side.fileError && <p className="text-xs text-destructive" role="alert">{side.fileError}</p>}
    </fieldset>
  );
}

type RowPick = { checked: boolean; onChange: () => void; label: string } | null;

function DiffTable({ head, labels, rows, picks, mono }: { head: string; labels: [string, string]; rows: string[][]; picks?: RowPick[]; mono?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">{head}</th>
            <th className="py-1 pr-3 font-medium">{labels[0]}</th>
            <th className="py-1 font-medium">{labels[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, before, after], i) => (
            <tr key={name} className="border-t border-border/50 align-top">
              <td className={`py-1 pr-3 break-all ${mono ? 'font-mono' : ''}`}>
                {picks?.[i] && (
                  <Checkbox className="mr-2 align-middle" checked={picks[i]!.checked} onCheckedChange={picks[i]!.onChange} aria-label={picks[i]!.label} data-testid="reset-select" />
                )}
                {name}
              </td>
              <td className="py-1 pr-3 whitespace-pre-wrap break-words">{before}</td>
              <td className="py-1 whitespace-pre-wrap break-words">{after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
