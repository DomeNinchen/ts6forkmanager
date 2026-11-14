import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SnapshotCompareResult, SnapshotCompareSource, SnapshotObjectDiff, SnapshotObjectKind, SnapshotPermValue } from '@ts6/common';
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
import { ArrowLeft, GitCompare, Search, Upload } from 'lucide-react';

const PAGE_SIZE = 25;
const KINDS: SnapshotObjectKind[] = ['serverGroup', 'channelGroup', 'channel'];

function errorText(err: any, fallback: string): string {
  return err?.response?.data?.details || err?.response?.data?.error || fallback;
}

export default function SnapshotCompare() {
  const { t, i18n } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sourceType, setSourceType] = useState<'backup' | 'file'>('backup');
  const [backup, setBackup] = useState('');
  const [file, setFile] = useState<{ name: string; snapshot: { version: string | number; data: string } } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | SnapshotObjectKind>('all');
  const [page, setPage] = useState(1);

  const sources = useQuery({
    queryKey: ['snapshot-compare-sources', selectedConfigId, selectedSid],
    queryFn: () => serversApi.snapshotCompareSources(selectedConfigId!, selectedSid!),
    enabled: !!selectedConfigId && !!selectedSid,
  });

  const compare = useMutation({
    mutationFn: (source: SnapshotCompareSource) => serversApi.compareSnapshot(selectedConfigId!, selectedSid!, source),
    onSuccess: () => setPage(1),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (compare.data?.objects ?? []).filter((o) => (kind === 'all' || o.kind === kind) && (!q
      || o.name.toLowerCase().includes(q) || String(o.id) === q
      || o.perms.some((p) => p.perm.includes(q)) || o.fields.some((f) => f.field.includes(q))));
  }, [compare.data, search, kind]);

  if (!selectedConfigId || !selectedSid) {
    return <EmptyState icon={GitCompare} title={t('pages.noServerSelected')} description={t('pages.serverStats.selectServerFirst')} />;
  }

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (typeof json?.data !== 'string' || json.version === undefined) throw new Error();
      setFile({ name: f.name, snapshot: { version: json.version, data: json.data } });
      setFileError(null);
    } catch {
      setFile(null);
      setFileError(t('pages.misc.notValidSnapshot'));
    }
  };

  const source: SnapshotCompareSource | null = sourceType === 'file'
    ? (file ? { type: 'file', snapshot: file.snapshot } : null)
    : (() => { const b = sources.data?.find((s) => `${s.kind}/${s.name}` === backup); return b ? { type: 'backup', kind: b.kind, name: b.name } : null; })();

  const result: SnapshotCompareResult | undefined = compare.data;
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const date = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/miscellaneous"><ArrowLeft className="h-4 w-4 mr-1" /> {t('nav.items.miscellaneous')}</Link>
        </Button>
        <h1 className="text-xl font-semibold">{t('pages.snapshotCompare.title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl">{t('pages.snapshotCompare.description')}</p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('pages.snapshotCompare.source')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 w-full sm:w-auto">
              <Label htmlFor="snapshot-source-type">{t('pages.snapshotCompare.sourceType')}</Label>
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as 'backup' | 'file')}>
                <SelectTrigger id="snapshot-source-type" className="w-full sm:w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="backup">{t('pages.snapshotCompare.fromBackup')}</SelectItem>
                  <SelectItem value="file">{t('pages.snapshotCompare.fromFile')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sourceType === 'backup' ? (
              <div className="space-y-1 w-full sm:w-auto">
                <Label htmlFor="snapshot-backup">{t('pages.snapshotCompare.backup')}</Label>
                <Select value={backup} onValueChange={setBackup} disabled={!sources.data?.length}>
                  <SelectTrigger id="snapshot-backup" className="w-full sm:w-[340px]"><SelectValue placeholder={t('pages.snapshotCompare.pickBackup')} /></SelectTrigger>
                  <SelectContent>
                    {sources.data?.map((s) => (
                      <SelectItem key={`${s.kind}/${s.name}`} value={`${s.kind}/${s.name}`}>
                        {date(s.createdAt)} · {t(`pages.backups.kind.${s.kind}`, { defaultValue: s.kind })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" /> {file ? file.name : t('pages.snapshotCompare.pickFile')}
                </Button>
                <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pickFile} />
              </div>
            )}
            <Button onClick={() => source && compare.mutate(source)} disabled={!source || compare.isPending} data-testid="snapshot-compare-run">
              <GitCompare className="h-4 w-4 mr-1" /> {compare.isPending ? t('pages.snapshotCompare.comparing') : t('pages.snapshotCompare.compare')}
            </Button>
          </div>
          {sourceType === 'backup' && sources.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('pages.snapshotCompare.noBackups')}</p>
          )}
          {sourceType === 'file' && fileError && <p className="text-xs text-destructive" role="alert">{fileError}</p>}
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
              {shown.map((o) => <ObjectDiff key={`${o.kind}-${o.id}`} o={o} />)}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground">{t('pages.snapshotCompare.noMatch')}</p>}
              <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage}
                countText={t('pages.snapshotCompare.objectCount', { count: filtered.length })} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_VARIANT = { added: 'success', removed: 'destructive', changed: 'warning' } as const;

function ObjectDiff({ o }: { o: SnapshotObjectDiff }) {
  const { t } = useTranslation();
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
    <DiffTable head={t('pages.snapshotCompare.permission')} rows={o.perms.map((p) => [p.perm, perm(p.before), perm(p.after)])} mono />
  );
  return (
    <Card data-testid="snapshot-compare-object">
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[o.status]}>{t(`pages.snapshotCompare.status.${o.status}`)}</Badge>
          <span className="text-xs text-muted-foreground">{t(`pages.snapshotCompare.kinds.${o.kind}`)}</span>
          <span className="font-medium break-all">{o.name}</span>
          <span className="text-xs text-muted-foreground">#{o.id}</span>
        </div>
        {o.fields.length > 0 && (
          <DiffTable head={t('pages.snapshotCompare.field')} rows={o.fields.map((f) => [fieldLabel(f.field), value(f.field, f.before), value(f.field, f.after)])} />
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

function DiffTable({ head, rows, mono }: { head: string; rows: string[][]; mono?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">{head}</th>
            <th className="py-1 pr-3 font-medium">{t('pages.snapshotCompare.before')}</th>
            <th className="py-1 font-medium">{t('pages.snapshotCompare.after')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, before, after]) => (
            <tr key={name} className="border-t border-border/50 align-top">
              <td className={`py-1 pr-3 break-all ${mono ? 'font-mono' : ''}`}>{name}</td>
              <td className="py-1 pr-3 whitespace-pre-wrap break-words">{before}</td>
              <td className="py-1 whitespace-pre-wrap break-words">{after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
