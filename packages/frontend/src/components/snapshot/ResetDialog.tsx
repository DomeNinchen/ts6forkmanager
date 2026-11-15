import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SnapshotCompareSource, SnapshotPermValue, SnapshotResetChoice, SnapshotResetOutcome, SnapshotRestoreResult } from '@ts6/common';
import { serversApi } from '@/api/servers.api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function errorOf(err: any, fallback: string): { text: string; backupFailed: boolean } {
  const data = err?.response?.data;
  return { text: data?.details ? `${data.error}: ${data.details}` : data?.error || fallback, backupFailed: data?.code === 'BACKUP_FAILED' };
}

/**
 * Sets the ticked permissions and fields of groups and channels that still exist back to the snapshot
 * of the "before" side: preview first, a backup before, then the result per item.
 */
export function ResetDialog({ configId, sid, source, items, onClose }: {
  configId: number;
  sid: number;
  source: SnapshotCompareSource;
  items: SnapshotResetChoice[];
  onClose: (changed: boolean) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'preview' | 'running' | 'done'>('preview');
  const [preview, setPreview] = useState<SnapshotResetOutcome[] | null>(null);
  const [result, setResult] = useState<SnapshotRestoreResult | null>(null);
  const [error, setError] = useState<{ text: string; backupFailed: boolean } | null>(null);

  useEffect(() => {
    serversApi.restoreSnapshotGroups(configId, sid, { source, reset: items, dryRun: true })
      .then((r) => setPreview(r.resets ?? []))
      .catch((err) => setError(errorOf(err, t('pages.snapshotCompare.reset.failed'))));
  }, [configId, sid, source, items, t]);

  const run = async (skipBackup = false) => {
    setPhase('running');
    setError(null);
    try {
      setResult(await serversApi.restoreSnapshotGroups(configId, sid, { source, reset: items, skipBackup }));
      setPhase('done');
    } catch (err) {
      setError(errorOf(err, t('pages.snapshotCompare.reset.failed')));
      setPhase('preview');
    }
  };

  const fieldLabel = (f: string) => t(`pages.snapshotCompare.fields.${f}`, { defaultValue: f });
  const valueOf = (o: SnapshotResetOutcome) => {
    if (o.to === null) return t('pages.snapshotCompare.reset.remove');
    if (typeof o.to === 'string') return o.to === '' ? t('pages.snapshotCompare.empty') : o.to;
    const p = o.to as SnapshotPermValue;
    const flags = [p.negated && t('pages.snapshotCompare.negated'), p.skip && t('pages.snapshotCompare.skip')].filter(Boolean);
    return flags.length ? `${p.value} (${flags.join(', ')})` : String(p.value);
  };
  const lines = phase === 'done' ? result?.resets ?? [] : preview ?? [];
  const variant = (s: SnapshotResetOutcome['status']) => (s === 'ok' || s === 'ready' ? 'success' : s === 'failed' ? 'destructive' : 'warning');

  return (
    <Dialog open onOpenChange={(open) => { if (!open && phase !== 'running') onClose(phase === 'done'); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="reset-dialog">
        <DialogHeader>
          <DialogTitle>{phase === 'done' ? t('pages.snapshotCompare.reset.resultTitle') : t('pages.snapshotCompare.reset.title')}</DialogTitle>
          <DialogDescription>{t('pages.snapshotCompare.reset.description')}</DialogDescription>
        </DialogHeader>
        {!preview && !error && <p className="text-sm text-muted-foreground">{t('pages.snapshotCompare.restore.checking')}</p>}
        {phase === 'done' && result && (result.backup
          ? <p className="text-xs text-muted-foreground">{t('pages.snapshotCompare.restore.backupTaken', { name: result.backup })}</p>
          : <p className="text-xs text-amber-500">{t('pages.snapshotCompare.restore.noBackup')}</p>)}
        <ul className="space-y-1 text-sm" data-testid={phase === 'done' ? 'reset-result' : 'reset-preview'}>
          {lines.map((o, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 border-b border-border/50 py-1" data-testid="reset-line">
              <Badge variant={variant(o.status)}>{t(`pages.snapshotCompare.reset.status.${o.status === 'skipped' ? `skipped-${o.reason}` : o.status}`)}</Badge>
              <span className="text-xs text-muted-foreground">{t(`pages.snapshotCompare.kinds.${o.kind}`)} {o.name} #{o.id}</span>
              <span className={o.item === 'perm' ? 'font-mono text-xs' : 'text-xs'}>{o.item === 'perm' ? o.key : fieldLabel(o.key)}</span>
              {o.status !== 'skipped' && <span className="text-xs">→ {valueOf(o)}</span>}
              {o.message && <span className="w-full text-xs text-destructive">{o.message}</span>}
            </li>
          ))}
        </ul>
        {phase !== 'done' && preview && <p className="text-xs text-muted-foreground">{t('pages.snapshotCompare.restore.backupNote')}</p>}
        {error && (
          <div className="space-y-2" role="alert" data-testid="reset-error">
            <p className="text-sm text-destructive">{error.text}</p>
            {error.backupFailed && <Button variant="outline" size="sm" onClick={() => run(true)}>{t('pages.snapshotCompare.restore.withoutBackup')}</Button>}
          </div>
        )}
        <DialogFooter>
          {phase === 'done' ? (
            <Button onClick={() => onClose(true)} data-testid="reset-close">{t('common.close')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onClose(false)} disabled={phase === 'running'}>{t('common.cancel')}</Button>
              <Button onClick={() => run()} disabled={!preview?.some((o) => o.status === 'ready') || phase === 'running'} data-testid="reset-confirm">
                {phase === 'running' ? t('pages.snapshotCompare.reset.running') : t('pages.snapshotCompare.reset.confirm')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
