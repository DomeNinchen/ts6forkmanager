import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GROUP_NAME_MAX } from '@ts6/common';
import type { SnapshotCompareSource, SnapshotGroupKind, SnapshotGroupReference, SnapshotRestoreOutcome, SnapshotRestoreResult } from '@ts6/common';
import { serversApi } from '@/api/servers.api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface RestoreTarget { kind: SnapshotGroupKind; id: number }

type Phase = 'preview' | 'running' | 'done';

function errorOf(err: any, fallback: string): { text: string; backupFailed: boolean } {
  const data = err?.response?.data;
  return { text: data?.details ? `${data.error}: ${data.details}` : data?.error || fallback, backupFailed: data?.code === 'BACKUP_FAILED' };
}

/**
 * Brings the chosen groups back from the snapshot of the "before" side: preview first (a taken name
 * needs a choice per group: skip or another name), then the run with a backup first, then the result
 * per group with what was skipped and what still points at the old ids.
 */
export function RestoreGroupsDialog({ configId, sid, source, targets, onClose }: {
  configId: number;
  sid: number;
  source: SnapshotCompareSource;
  targets: RestoreTarget[];
  onClose: (changed: boolean) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('preview');
  const [preview, setPreview] = useState<SnapshotRestoreOutcome[] | null>(null);
  const [result, setResult] = useState<SnapshotRestoreResult | null>(null);
  const [error, setError] = useState<{ text: string; backupFailed: boolean } | null>(null);
  const [members, setMembers] = useState(false);
  // Per group with a taken name: undefined = skip, a string = create under that name.
  const [newNames, setNewNames] = useState<Record<string, string | undefined>>({});
  const keyOf = (o: { kind: string; oldId?: number; id?: number }) => `${o.kind}:${o.oldId ?? o.id}`;

  useEffect(() => {
    serversApi.restoreSnapshotGroups(configId, sid, { source, groups: targets, dryRun: true })
      .then((r) => setPreview(r.outcomes))
      .catch((err) => setError(errorOf(err, t('pages.snapshotCompare.restore.failed'))));
  }, [configId, sid, source, targets, t]);

  const run = async (skipBackup = false) => {
    setPhase('running');
    setError(null);
    try {
      const groups = targets.map((g) => ({ ...g, ...(newNames[keyOf(g)] !== undefined ? { newName: newNames[keyOf(g)] } : {}) }));
      setResult(await serversApi.restoreSnapshotGroups(configId, sid, { source, groups, members, skipBackup }));
      setPhase('done');
    } catch (err) {
      setError(errorOf(err, t('pages.snapshotCompare.restore.failed')));
      setPhase('preview');
    }
  };

  const nameInvalid = Object.values(newNames).some((n) => n !== undefined && (n.trim() === '' || n.trim().length > GROUP_NAME_MAX));
  const anyMembers = preview?.some((o) => (o.members?.inSnapshot ?? 0) > 0);
  const kindLabel = (k: SnapshotGroupKind) => t(`pages.snapshotCompare.kinds.${k}`);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && phase !== 'running') onClose(phase === 'done'); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="restore-dialog">
        <DialogHeader>
          <DialogTitle>{phase === 'done' ? t('pages.snapshotCompare.restore.resultTitle') : t('pages.snapshotCompare.restore.title', { count: targets.length })}</DialogTitle>
          <DialogDescription>{phase === 'done' ? t('pages.snapshotCompare.restore.resultDescription') : t('pages.snapshotCompare.restore.description')}</DialogDescription>
        </DialogHeader>

        {phase !== 'done' && (
          <div className="space-y-3">
            {!preview && !error && <p className="text-sm text-muted-foreground">{t('pages.snapshotCompare.restore.checking')}</p>}
            {preview?.map((o) => (
              <div key={keyOf(o)} className="rounded-md border border-border p-3 space-y-2" data-testid="restore-preview-group">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={o.status === 'ready' ? 'success' : o.status === 'name-taken' ? 'warning' : 'secondary'}>{t(`pages.snapshotCompare.restore.status.${o.status === 'skipped' ? `skipped-${o.reason}` : o.status}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{kindLabel(o.kind)}</span>
                  <span className="font-medium break-all">{o.name}</span>
                  <span className="text-xs text-muted-foreground">#{o.oldId}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('pages.snapshotCompare.restore.permissions', { count: o.permissions })}
                  {o.members && ` · ${t('pages.snapshotCompare.restore.membersInSnapshot', { count: o.members.inSnapshot })}`}
                </p>
                {o.status === 'name-taken' && (
                  <fieldset className="space-y-2 text-sm" data-testid="restore-name-choice">
                    <legend className="text-xs">{t('pages.snapshotCompare.restore.nameTaken')}</legend>
                    <label className="flex items-center gap-2">
                      <input type="radio" name={`name-${keyOf(o)}`} checked={newNames[keyOf(o)] === undefined} onChange={() => setNewNames((n) => ({ ...n, [keyOf(o)]: undefined }))} />
                      {t('pages.snapshotCompare.restore.skipIt')}
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name={`name-${keyOf(o)}`} checked={newNames[keyOf(o)] !== undefined}
                        onChange={() => setNewNames((n) => ({ ...n, [keyOf(o)]: `${o.name.slice(0, GROUP_NAME_MAX - 4)} (2)` }))} />
                      {t('pages.snapshotCompare.restore.otherName')}
                    </label>
                    {newNames[keyOf(o)] !== undefined && (
                      <div className="pl-6 space-y-1">
                        <Label htmlFor={`newname-${keyOf(o)}`} className="sr-only">{t('pages.snapshotCompare.restore.newName')}</Label>
                        <Input id={`newname-${keyOf(o)}`} value={newNames[keyOf(o)]} maxLength={GROUP_NAME_MAX} aria-label={t('pages.snapshotCompare.restore.newName')}
                          onChange={(e) => setNewNames((n) => ({ ...n, [keyOf(o)]: e.target.value }))} data-testid="restore-new-name" />
                        <p className="text-[11px] text-muted-foreground">{t('pages.snapshotCompare.restore.nameLimit', { max: GROUP_NAME_MAX })}</p>
                      </div>
                    )}
                  </fieldset>
                )}
                <References refs={o.references} />
              </div>
            ))}
            {anyMembers && (
              <div className="flex items-start gap-2">
                <Checkbox id="restore-members" checked={members} onCheckedChange={(v) => setMembers(v === true)} data-testid="restore-members" />
                <Label htmlFor="restore-members" className="text-sm font-normal leading-snug">{t('pages.snapshotCompare.restore.members')}</Label>
              </div>
            )}
            {preview && <p className="text-xs text-muted-foreground">{t('pages.snapshotCompare.restore.newIdsNote')}</p>}
            {preview && <p className="text-xs text-muted-foreground">{t('pages.snapshotCompare.restore.backupNote')}</p>}
            {error && (
              <div className="space-y-2" role="alert" data-testid="restore-error">
                <p className="text-sm text-destructive">{error.text}</p>
                {error.backupFailed && (
                  <Button variant="outline" size="sm" onClick={() => run(true)} data-testid="restore-without-backup">{t('pages.snapshotCompare.restore.withoutBackup')}</Button>
                )}
              </div>
            )}
          </div>
        )}

        {phase === 'done' && result && <ResultView result={result} />}

        <DialogFooter>
          {phase === 'done' ? (
            <Button onClick={() => onClose(true)} data-testid="restore-close">{t('common.close')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onClose(false)} disabled={phase === 'running'}>{t('common.cancel')}</Button>
              <Button onClick={() => run()} disabled={!preview || phase === 'running' || nameInvalid || !preview.some((o) => o.status === 'ready' || newNames[keyOf(o)] !== undefined)} data-testid="restore-confirm">
                {phase === 'running' ? t('pages.snapshotCompare.restore.running') : t('pages.snapshotCompare.restore.confirm')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function References({ refs, newId }: { refs: SnapshotGroupReference[]; newId?: number }) {
  const { t } = useTranslation();
  if (refs.length === 0) return null;
  return (
    <div className="text-xs space-y-1" data-testid="restore-references">
      <p className="text-amber-500">{newId ? t('pages.snapshotCompare.restore.referencesAfter', { newId }) : t('pages.snapshotCompare.restore.references')}</p>
      <ul className="list-disc pl-5 text-muted-foreground">
        {refs.map((r, i) => <li key={i}>{t(`pages.snapshotCompare.restore.where.${r.where}`)}{r.detail ? `: ${r.detail}` : ''}</li>)}
      </ul>
    </div>
  );
}

function ResultView({ result }: { result: SnapshotRestoreResult }) {
  const { t } = useTranslation();
  const created = result.outcomes.filter((o) => o.status === 'created');
  const skipped = result.outcomes.filter((o) => o.status === 'skipped');
  const failed = result.outcomes.filter((o) => o.status === 'failed');
  return (
    <div className="space-y-4 text-sm" data-testid="restore-result">
      {result.backup ? <p className="text-xs text-muted-foreground">{t('pages.snapshotCompare.restore.backupTaken', { name: result.backup })}</p>
        : <p className="text-xs text-amber-500">{t('pages.snapshotCompare.restore.noBackup')}</p>}
      {created.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">{t('pages.snapshotCompare.restore.createdHeading', { count: created.length })}</h3>
          {created.map((o) => (
            <div key={`${o.kind}:${o.oldId}`} className="rounded-md border border-border p-3 space-y-1" data-testid="restore-created">
              <p><span className="font-medium">{o.createdAs ?? o.name}</span> <span className="text-xs text-muted-foreground">{t('pages.snapshotCompare.restore.idMap', { oldId: o.oldId, newId: o.newId })}</span></p>
              <p className="text-xs text-muted-foreground">
                {t('pages.snapshotCompare.restore.permsSet', { count: o.permissions - (o.permFailures?.filter((f) => f.perm !== '*').length ?? 0), total: o.permissions })}
                {o.members?.added !== undefined && o.members.inSnapshot > 0 && ` ·${t('pages.snapshotCompare.restore.membersResult', { added: o.members.added, missing: o.members.missing, failed: o.members.failed })}`}
              </p>
              {o.permFailures && (
                <ul className="text-xs text-destructive list-disc pl-5">
                  {o.permFailures.map((f) => <li key={f.perm}><span className="font-mono">{f.perm}</span>: {f.message}</li>)}
                </ul>
              )}
              <References refs={o.references} newId={o.newId} />
            </div>
          ))}
        </section>
      )}
      {skipped.length > 0 && (
        <section className="space-y-1" data-testid="restore-skipped">
          <h3 className="font-medium">{t('pages.snapshotCompare.restore.skippedHeading', { count: skipped.length })}</h3>
          <ul className="list-disc pl-5">
            {skipped.map((o) => <li key={`${o.kind}:${o.oldId}`}>{o.createdAs ?? o.name} (#{o.oldId}): {t(`pages.snapshotCompare.restore.status.skipped-${o.reason}`)}</li>)}
          </ul>
        </section>
      )}
      {failed.length > 0 && (
        <section className="space-y-1">
          <h3 className="font-medium text-destructive">{t('pages.snapshotCompare.restore.failedHeading', { count: failed.length })}</h3>
          <ul className="list-disc pl-5">
            {failed.map((o) => <li key={`${o.kind}:${o.oldId}`}>{o.name} (#{o.oldId}): {o.message}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
