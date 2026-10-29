import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, Info, RotateCcw, ShieldCheck, Trash2, Upload, XCircle } from 'lucide-react';
import type { BackupCheckResult, BackupEntry, BackupOverview, BackupSettings } from '@ts6/common';
import { backupsApi } from '@/api/backups.api';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

/** How long the outcome of the last restore stays at the top of the page. */
const RESTORE_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const errorText = (err: any, fallback: string) => {
  const d = err?.response?.data;
  return d?.details ? `${d.error}: ${d.details}` : d?.error ?? fallback;
};

/**
 * Backups of the manager's own database (R7): back up now, a schedule with its own retention,
 * test a backup without replacing anything, download, delete. Admin-only: a backup holds password
 * hashes and the encrypted TeamSpeak credentials.
 */
export default function Backups() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['backups'], queryFn: backupsApi.overview });
  const [toDelete, setToDelete] = useState<BackupEntry | null>(null);
  const [checked, setChecked] = useState<{ entry: BackupEntry; result: BackupCheckResult } | null>(null);
  const [restoreFor, setRestoreFor] = useState<BackupEntry | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['backups'] });

  const saveSnapshots = useMutation({
    mutationFn: (on: boolean) => backupsApi.setSettings({ ...data!.settings, includeTsSnapshots: on }),
    onSuccess: (overview) => qc.setQueryData(['backups'], overview),
    onError: (err) => toast.error(errorText(err, t('pages.backups.schedule.saveFailed'))),
  });

  const cancelRestore = useMutation({
    mutationFn: backupsApi.cancelRestore,
    onSuccess: () => { void refresh(); toast.success(t('pages.backups.restore.cancelled')); },
    onError: (err) => toast.error(errorText(err, t('pages.backups.restore.cancelFailed'))),
  });

  const create = useMutation({
    mutationFn: backupsApi.create,
    onSuccess: (entry) => { void refresh(); toast.success(t('pages.backups.created', { size: formatBytes(entry.size) })); },
    onError: (err) => { void refresh(); toast.error(errorText(err, t('pages.backups.createFailed'))); },
  });

  const check = useMutation({
    mutationFn: (entry: BackupEntry) => backupsApi.check(entry.kind, entry.name),
    onSuccess: (result, entry) => setChecked({ entry, result }),
    onError: (err) => toast.error(errorText(err, t('pages.backups.checkFailed'))),
  });

  const download = useMutation({
    mutationFn: (entry: BackupEntry) => backupsApi.createDownloadLink(entry.kind, entry.name),
    onSuccess: ({ url }) => {
      const anchor = document.createElement('a');
      anchor.href = url;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      toast.success(t('pages.backups.downloadStarted'));
    },
    onError: (err) => toast.error(errorText(err, t('pages.backups.downloadFailed'))),
  });

  const remove = useMutation({
    mutationFn: (entry: BackupEntry) => backupsApi.remove(entry.kind, entry.name),
    onSuccess: () => { void refresh(); setToDelete(null); toast.success(t('pages.backups.deleted')); },
    onError: (err) => toast.error(errorText(err, t('pages.backups.deleteFailed'))),
  });

  if (isLoading) return <PageLoader />;
  if (isError || !data) return <p className="text-sm text-destructive">{t('pages.backups.loadFailed')}</p>;

  const busy = (m: { isPending: boolean; variables?: BackupEntry }, entry: BackupEntry) => m.isPending && m.variables?.name === entry.name;
  const last = data.lastRestore && Date.now() - Date.parse(data.lastRestore.at) < RESTORE_NOTICE_MS ? data.lastRestore : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t('pages.backups.title')}</h1>
        <p className="text-xs text-muted-foreground mt-1">{t('pages.backups.subtitle')}</p>
      </div>

      {data.pendingRestore && (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" role="status" data-testid="backup-pending-restore">
          <Info className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <div className="flex-1 min-w-[200px]">
            <p className="font-medium">{t('pages.backups.restore.pending', { time: new Date(data.pendingRestore.requestedAt).toLocaleString(), user: data.pendingRestore.requestedBy })}</p>
            <p className="text-xs text-muted-foreground break-all">{data.pendingRestore.name}</p>
            <p className="text-xs text-muted-foreground">{t('pages.backups.restore.pendingHint')}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => cancelRestore.mutate()} disabled={cancelRestore.isPending} data-testid="backup-cancel-restore">
            {t('pages.backups.restore.cancel')}
          </Button>
        </div>
      )}

      {last && (
        <div
          className={`flex gap-2 rounded-md border p-3 text-sm ${last.ok ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-destructive/50 bg-destructive/10'}`}
          role={last.ok ? 'status' : 'alert'}
          data-testid="backup-last-restore"
          data-ok={last.ok}
        >
          {last.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />}
          <div className="min-w-0">
            <p className="font-medium">
              {last.ok
                ? t('pages.backups.restore.lastOk', { time: new Date(last.at).toLocaleString(), user: last.requestedBy })
                : last.rolledBack
                  ? t('pages.backups.restore.lastRolledBack', { time: new Date(last.at).toLocaleString() })
                  : t('pages.backups.restore.lastFailed', { time: new Date(last.at).toLocaleString() })}
            </p>
            <p className="text-xs text-muted-foreground break-all">{last.name}</p>
            {last.error && <p className="text-xs text-muted-foreground break-words">{last.error}</p>}
            {last.beforeRestore && <p className="text-xs text-muted-foreground break-all">{t('pages.backups.restore.beforeRestoreSaved', { name: last.beforeRestore })}</p>}
          </div>
        </div>
      )}

      {data.lastRun && !data.lastRun.ok && (
        <div className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm" role="alert" data-testid="backup-last-failed">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
          <div>
            <p className="font-medium">{t(`pages.backups.lastFailed.${data.lastRun.kind}`, { time: new Date(data.lastRun.at).toLocaleString() })}</p>
            <p className="text-xs text-muted-foreground break-words">{data.lastRun.error}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="card-hero">
          <CardHeader>
            <CardTitle className="text-sm font-medium">{t('pages.backups.now.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('pages.backups.now.description')}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t('pages.backups.now.databaseSize')}</dt>
              <dd className="font-mono-data">{formatBytes(data.databaseBytes)}</dd>
              <dt className="text-muted-foreground">{t('pages.backups.now.freeSpace')}</dt>
              <dd className="font-mono-data">{data.freeBytes === null ? '–' : formatBytes(data.freeBytes)}</dd>
              {data.lastRun?.ok && (
                <>
                  <dt className="text-muted-foreground">{t('pages.backups.now.lastRun')}</dt>
                  <dd className="font-mono-data">{new Date(data.lastRun.at).toLocaleString()}</dd>
                </>
              )}
            </dl>
            <p className="text-[11px] text-muted-foreground">{t('pages.backups.now.keyNote')}</p>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-xs" htmlFor="backup-ts-snapshots">{t('pages.backups.now.tsSnapshotsLabel')}</Label>
                <p className="text-[11px] text-muted-foreground">{t('pages.backups.now.tsSnapshotsHint')}</p>
              </div>
              <Switch id="backup-ts-snapshots" checked={data.settings.includeTsSnapshots} disabled={saveSnapshots.isPending}
                onCheckedChange={(v) => saveSnapshots.mutate(v)} data-testid="backup-ts-snapshots" />
            </div>
            <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending} data-testid="backup-now">
              {create.isPending ? t('pages.backups.now.running') : t('pages.backups.now.button')}
            </Button>
          </CardContent>
        </Card>

        <ScheduleCard settings={data.settings} bounds={data.bounds} serverTime={data.serverTime} />
        <UploadCard settings={data.settings} bounds={data.bounds} />
      </div>

      <div className="card-hero rounded-md border border-border overflow-x-auto lounge:rounded-none lounge:border-0 lounge:border-t-2 lounge:border-foreground/80 lounge:bg-transparent lounge:shadow-none">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 lounge:bg-transparent text-left text-muted-foreground">
              <th className="h-10 px-3 font-medium">{t('pages.backups.columns.time')}</th>
              <th className="h-10 px-3 font-medium">{t('pages.backups.columns.kind')}</th>
              <th className="h-10 px-3 font-medium">{t('pages.backups.columns.size')}</th>
              <th className="h-10 px-3 font-medium">{t('pages.backups.columns.version')}</th>
              <th className="h-10 px-3 font-medium text-right">{t('pages.backups.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.backups.length === 0 ? (
              <tr><td colSpan={5} className="h-24 text-center text-muted-foreground">{t('pages.backups.empty')}</td></tr>
            ) : (
              data.backups.map((entry) => (
                <tr key={`${entry.kind}/${entry.name}`} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors" data-testid="backup-row" data-kind={entry.kind}>
                  <td className="px-3 py-2.5 whitespace-nowrap font-mono-data text-xs">
                    {new Date(entry.createdAt).toLocaleString()}
                    {entry.createdBy && <div className="text-[11px] text-muted-foreground">{entry.createdBy}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline">{t(`pages.backups.kind.${entry.kind}`)}</Badge>
                    {entry.tsSnapshots !== null && (
                      <div className="text-[11px] text-muted-foreground mt-1" data-testid="backup-ts-count">{t('pages.backups.tsSnapshotCount', { count: entry.tsSnapshots })}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-mono-data text-xs">{formatBytes(entry.size)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-mono-data text-xs">
                    {entry.backendVersion === null ? '–' : entry.kind === 'before-update' ? t('pages.backups.beforeVersion', { version: entry.backendVersion }) : entry.backendVersion}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => check.mutate(entry)} disabled={check.isPending} title={t('pages.backups.actions.check')} data-testid="backup-check">
                        <ShieldCheck className="h-4 w-4" />
                        <span className="hidden sm:inline ml-1">{busy(check, entry) ? t('pages.backups.actions.checking') : t('pages.backups.actions.check')}</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => download.mutate(entry)} disabled={busy(download, entry)} title={t('pages.backups.actions.download')} aria-label={t('pages.backups.actions.download')} data-testid="backup-download">
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRestoreFor(entry)} title={t('pages.backups.actions.restore')} aria-label={t('pages.backups.actions.restore')} data-testid="backup-restore">
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      {entry.kind !== 'before-update' && (
                        <Button variant="ghost" size="sm" onClick={() => setToDelete(entry)} title={t('pages.backups.actions.delete')} aria-label={t('pages.backups.actions.delete')} data-testid="backup-delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">{t('pages.backups.beforeUpdateNote')}</p>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t('pages.backups.deleteTitle')}
        description={t('pages.backups.deleteDescription', { time: toDelete ? new Date(toDelete.createdAt).toLocaleString() : '' })}
        confirmLabel={t('pages.backups.actions.delete')}
        destructive
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
      />

      <Dialog open={checked !== null} onOpenChange={(open) => !open && setChecked(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pages.backups.check.title')}</DialogTitle>
          </DialogHeader>
          {checked && <CheckView result={checked.result} entry={checked.entry} />}
        </DialogContent>
      </Dialog>

      {restoreFor && <RestoreDialog entry={restoreFor} databaseBytes={data.databaseBytes} onClose={() => setRestoreFor(null)} />}
    </div>
  );
}

/**
 * The restore wizard: the checks, what will be replaced, the confirmation. The backend checks
 * again, marks the backup for the next start and restarts; the start saves the current state
 * first, puts the backup in place and migrates it.
 */
function RestoreDialog({ entry, databaseBytes, onClose }: { entry: BackupEntry; databaseBytes: number; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [understood, setUnderstood] = useState(false);
  const [acceptKey, setAcceptKey] = useState(false);
  const check = useQuery({
    queryKey: ['backups', 'restore-check', entry.kind, entry.name],
    queryFn: () => backupsApi.check(entry.kind, entry.name),
    gcTime: 0,
    retry: false,
  });
  const restore = useMutation({
    mutationFn: () => backupsApi.restore(entry.kind, entry.name, acceptKey),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['backups'] }),
    onError: (err) => toast.error(errorText(err, t('pages.backups.restore.failed'))),
  });

  const result = check.data;
  const blocked = !result || !result.integrity.ok || (result.checksum !== null && !result.checksum.ok)
    || result.migrations.state === 'newer' || result.migrations.state === 'no-history';
  const keyProblem = !!result && result.key.failed > 0;
  const canRestore = !blocked && understood && (!keyProblem || acceptKey) && !restore.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && !restore.isPending && (restore.isSuccess ? useAuthStore.getState().logout() : onClose())}>
      <DialogContent className="max-w-lg" data-testid="backup-restore-dialog">
        <DialogHeader>
          <DialogTitle>{t('pages.backups.restore.title')}</DialogTitle>
        </DialogHeader>
        {restore.isSuccess ? (
          <div className="space-y-2 text-sm" data-testid="backup-restore-started">
            <p className="font-medium">{t('pages.backups.restore.started')}</p>
            <p className="text-xs text-muted-foreground">{t('pages.backups.restore.startedHint')}</p>
          </div>
        ) : check.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('pages.backups.actions.checking')}</p>
        ) : check.isError || !result ? (
          <p className="text-sm text-destructive">{errorText(check.error, t('pages.backups.checkFailed'))}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <CheckView result={result} entry={entry} />
            {result.migrations.state === 'no-history' && <p className="text-xs text-destructive">{t('pages.backups.restore.noHistory')}</p>}
            {!blocked && (
              <>
                <div className="space-y-1">
                  <p className="font-medium">{t('pages.backups.restore.whatHappens')}</p>
                  <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                    <li>{t('pages.backups.restore.replaces', { now: formatBytes(databaseBytes), time: new Date(entry.createdAt).toLocaleString(), size: formatBytes(entry.size) })}</li>
                    <li>{t('pages.backups.restore.savesCurrent')}</li>
                    {result.migrations.state === 'older' && <li>{t('pages.backups.restore.migrates', { count: result.migrations.pending.length })}</li>}
                    <li>{t('pages.backups.restore.signsOut')}</li>
                    <li>{t('pages.backups.restore.restarts')}</li>
                  </ul>
                </div>
                {keyProblem && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2">
                    <Checkbox id="restore-accept-key" checked={acceptKey} onCheckedChange={(v) => setAcceptKey(v === true)} data-testid="backup-restore-accept-key" />
                    <Label htmlFor="restore-accept-key" className="text-xs leading-snug">{t('pages.backups.restore.acceptKey')}</Label>
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <Checkbox id="restore-understood" checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} data-testid="backup-restore-understood" />
                  <Label htmlFor="restore-understood" className="text-xs leading-snug">{t('pages.backups.restore.understood')}</Label>
                </div>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          {/* After a restore every login is void (the backend refuses it from the start on): go to the sign-in page right away instead of on the next request. */}
          <Button variant="outline" onClick={restore.isSuccess ? () => useAuthStore.getState().logout() : onClose} disabled={restore.isPending}>
            {restore.isSuccess ? t('common.close') : t('common.cancel')}
          </Button>
          {!restore.isSuccess && (
            <Button variant="destructive" disabled={!canRestore} onClick={() => restore.mutate()} data-testid="backup-restore-confirm">
              {restore.isPending ? t('pages.backups.restore.running') : t('pages.backups.restore.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Upload a backup (a ZIP downloaded from this page, or a .db), and the size limit for that. */
function UploadCard({ settings, bounds }: { settings: BackupSettings; bounds: BackupOverview['bounds'] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [limit, setLimit] = useState(String(settings.maxUploadMb));
  useEffect(() => setLimit(String(settings.maxUploadMb)), [settings.maxUploadMb]);
  const limitNum = Number(limit);
  const limitValid = Number.isInteger(limitNum) && limitNum >= bounds.uploadMbMin && limitNum <= bounds.uploadMbMax;

  const upload = useMutation({
    mutationFn: (file: File) => {
      setProgress({ loaded: 0, total: file.size });
      return backupsApi.upload(file, (loaded) => setProgress({ loaded, total: file.size }));
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['backups'] }); toast.success(t('pages.backups.upload.done')); },
    onError: (err: any) => toast.error(err?.response?.status === 413 && typeof err.response.data !== 'object'
      ? t('pages.backups.upload.proxyTooLarge')
      : errorText(err, t('pages.backups.upload.failed'))),
    onSettled: () => setProgress(null),
  });

  const saveLimit = useMutation({
    mutationFn: () => backupsApi.setSettings({ ...settings, maxUploadMb: limitNum }),
    onSuccess: (overview) => { qc.setQueryData(['backups'], overview); toast.success(t('pages.backups.upload.limitSaved')); },
    onError: (err) => toast.error(errorText(err, t('pages.backups.schedule.saveFailed'))),
  });

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > settings.maxUploadMb * 1024 * 1024) {
      toast.error(t('pages.backups.upload.tooLarge', { size: formatBytes(file.size), limit: settings.maxUploadMb }));
      return;
    }
    upload.mutate(file);
  };

  return (
    <Card className="card-hero">
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t('pages.backups.upload.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('pages.backups.upload.description')}</p>
        <input ref={input} type="file" accept=".zip,.db" className="hidden" data-testid="backup-upload-input"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending} data-testid="backup-upload">
          <Upload className="h-4 w-4 mr-1" />{upload.isPending ? t('pages.backups.upload.running') : t('pages.backups.upload.button')}
        </Button>
        {progress && (
          <div className="space-y-1">
            <Progress value={progress.total ? (progress.loaded / progress.total) * 100 : 0} />
            <p className="text-[11px] text-muted-foreground font-mono-data">{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</p>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="backup-upload-limit">{t('pages.backups.upload.limitLabel')}</Label>
          <div className="flex gap-2">
            <Input id="backup-upload-limit" type="number" min={bounds.uploadMbMin} max={bounds.uploadMbMax} value={limit}
              onChange={(e) => setLimit(e.target.value)} aria-invalid={!limitValid} className="max-w-[160px]" data-testid="backup-upload-limit" />
            <Button size="sm" disabled={!limitValid || limitNum === settings.maxUploadMb || saveLimit.isPending} onClick={() => saveLimit.mutate()} data-testid="backup-upload-limit-save">
              {t('pages.backups.schedule.save')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('pages.backups.upload.limitHint', { min: bounds.uploadMbMin, max: bounds.uploadMbMax })}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Line({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const Icon = ok ? (warn ? AlertTriangle : CheckCircle2) : XCircle;
  const color = ok ? (warn ? 'text-amber-500' : 'text-emerald-500') : 'text-destructive';
  return (
    <li className="flex gap-2">
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${color}`} />
      <div className="min-w-0">{children}</div>
    </li>
  );
}

function CheckView({ result, entry }: { result: BackupCheckResult; entry: BackupEntry }) {
  const { t } = useTranslation();
  const m = result.migrations;
  return (
    <div className="space-y-3 text-sm" data-testid="backup-check-result" data-ok={result.ok}>
      <p className="text-xs text-muted-foreground font-mono-data break-all">{entry.name}</p>
      <ul className="space-y-2">
        <Line ok={result.integrity.ok}>
          {result.integrity.ok ? t('pages.backups.check.integrityOk') : t('pages.backups.check.integrityFailed')}
          {!result.integrity.ok && <p className="text-xs text-muted-foreground break-words">{result.integrity.message}</p>}
        </Line>
        {result.checksum ? (
          <Line ok={result.checksum.ok}>{result.checksum.ok ? t('pages.backups.check.checksumOk') : t('pages.backups.check.checksumFailed')}</Line>
        ) : (
          <Line ok warn>{t('pages.backups.check.noManifest')}</Line>
        )}
        {result.integrity.ok && (
          <Line ok={m.state !== 'newer'} warn={m.state === 'older' || m.state === 'no-history'}>
            {t(`pages.backups.check.migrations.${m.state}`, { count: m.state === 'newer' ? m.unknown.length : m.pending.length })}
          </Line>
        )}
        {result.integrity.ok && (
          result.key.checked === 0 ? (
            <Line ok warn>{t('pages.backups.check.keyNothing')}</Line>
          ) : (
            <Line ok={result.key.failed === 0}>
              {result.key.failed === 0
                ? t('pages.backups.check.keyOk', { count: result.key.checked })
                : t('pages.backups.check.keyFailed', { failed: result.key.failed, count: result.key.checked })}
              {result.key.failed > 0 && <p className="text-xs text-muted-foreground font-mono-data break-all">{result.key.failedFields.join(', ')}</p>}
            </Line>
          )
        )}
      </ul>
      <p className={`font-medium ${result.ok ? 'text-emerald-500' : 'text-destructive'}`}>
        {result.ok ? t('pages.backups.check.verdictOk') : t('pages.backups.check.verdictFailed')}
      </p>
    </div>
  );
}

function ScheduleCard({ settings, bounds, serverTime }: { settings: BackupSettings; bounds: { keepMin: number; keepMax: number; maxAgeMin: number; maxAgeMax: number }; serverTime: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(settings.scheduleEnabled);
  const [time, setTime] = useState(settings.time);
  const [days, setDays] = useState(settings.days);
  const [keep, setKeep] = useState(String(settings.keep));
  const [maxAge, setMaxAge] = useState(settings.maxAgeDays === null ? '' : String(settings.maxAgeDays));

  // The form follows what the server holds - first load, and after a save.
  useEffect(() => {
    setEnabled(settings.scheduleEnabled);
    setTime(settings.time);
    setDays(settings.days);
    setKeep(String(settings.keep));
    setMaxAge(settings.maxAgeDays === null ? '' : String(settings.maxAgeDays));
  }, [settings]);

  const keepNum = Number(keep);
  const maxAgeNum = maxAge.trim() === '' ? null : Number(maxAge);
  const keepValid = Number.isInteger(keepNum) && keepNum >= bounds.keepMin && keepNum <= bounds.keepMax;
  const maxAgeValid = maxAgeNum === null || (Number.isInteger(maxAgeNum) && maxAgeNum >= bounds.maxAgeMin && maxAgeNum <= bounds.maxAgeMax);
  const valid = keepValid && maxAgeValid && days.length > 0 && /^\d{2}:\d{2}$/.test(time);
  const dirty = enabled !== settings.scheduleEnabled || time !== settings.time || keepNum !== settings.keep || maxAgeNum !== settings.maxAgeDays
    || days.join() !== settings.days.join();

  const save = useMutation({
    mutationFn: () => backupsApi.setSettings({ ...settings, scheduleEnabled: enabled, time, days, keep: keepNum, maxAgeDays: maxAgeNum }),
    onSuccess: (overview) => { qc.setQueryData(['backups'], overview); toast.success(t('pages.backups.schedule.saved')); },
    onError: (err) => toast.error(errorText(err, t('pages.backups.schedule.saveFailed'))),
  });

  const toggleDay = (day: number) => setDays((d) => (d.includes(day) ? d.filter((x) => x !== day) : [...d, day].sort((a, b) => a - b)));

  return (
    <Card className="card-hero">
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t('pages.backups.schedule.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-xs" htmlFor="backup-schedule">{t('pages.backups.schedule.enabledLabel')}</Label>
            <p className="text-[11px] text-muted-foreground">{t('pages.backups.schedule.enabledHint')}</p>
          </div>
          <Switch id="backup-schedule" checked={enabled} onCheckedChange={setEnabled} data-testid="backup-schedule-enabled" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="backup-time">{t('pages.backups.schedule.timeLabel')}</Label>
            <Input id="backup-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="backup-time" />
            <p className="text-[11px] text-muted-foreground" data-testid="backup-server-time">{t('pages.backups.schedule.serverTime', { time: serverTime })}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('pages.backups.schedule.daysLabel')}</Label>
            <div className="flex flex-wrap gap-1">
              {DAY_KEYS.map((key, i) => (
                <Button key={key} type="button" variant={days.includes(i) ? 'default' : 'outline'} size="sm" className="h-7 w-10 px-0 text-xs" onClick={() => toggleDay(i)} aria-pressed={days.includes(i)}>
                  {t(`pages.settings.restart.days.${key}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="backup-keep">{t('pages.backups.schedule.keepLabel')}</Label>
            <Input id="backup-keep" type="number" min={bounds.keepMin} max={bounds.keepMax} value={keep} onChange={(e) => setKeep(e.target.value)} aria-invalid={!keepValid} data-testid="backup-keep" />
            <p className="text-[11px] text-muted-foreground">{t('pages.backups.schedule.keepHint', { min: bounds.keepMin, max: bounds.keepMax })}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="backup-max-age">{t('pages.backups.schedule.maxAgeLabel')}</Label>
            <Input id="backup-max-age" type="number" min={bounds.maxAgeMin} max={bounds.maxAgeMax} value={maxAge} placeholder={t('pages.backups.schedule.maxAgeNone')} onChange={(e) => setMaxAge(e.target.value)} aria-invalid={!maxAgeValid} data-testid="backup-max-age" />
            <p className="text-[11px] text-muted-foreground">{t('pages.backups.schedule.maxAgeHint', { min: bounds.maxAgeMin, max: bounds.maxAgeMax })}</p>
          </div>
        </div>
        {days.length === 0 && <p className="text-[11px] text-destructive">{t('pages.backups.schedule.noDays')}</p>}

        <Button size="sm" disabled={!dirty || !valid || save.isPending} onClick={() => save.mutate()} data-testid="backup-schedule-save">
          {t('pages.backups.schedule.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
