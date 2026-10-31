import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BulkBackupScope } from '@ts6/common';
import { DatabaseBackup } from 'lucide-react';
import { toast } from 'sonner';
import { bulkBackupApi } from '@/api/bulk-backup.api';
import { Button } from '@/components/ui/button';
import { useServerStore } from '@/stores/server.store';

const reasonOf = (err: any): string => {
  const d = err?.response?.data;
  return d?.error ? (d.details ? `${d.error}: ${d.details}` : d.error) : String(err?.message ?? err);
};

/**
 * The backup step of a deletion a TeamSpeak snapshot can bring back (R9): groups and channels are
 * always backed up first, profiles from the threshold on; below it the dialog shows the last
 * backup and "back up now". `guard(run)` runs the deletion after the backup; when the backup fails,
 * the dialog shows why and offers `skip()`, which runs it with `skipBackup`.
 */
export function useBackupStep(scope: BulkBackupScope, count: number, open: boolean) {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const qc = useQueryClient();
  const key = ['bulk-backup', c, s, scope];
  const status = useQuery({ queryKey: key, queryFn: () => bulkBackupApi.status(c!, s!, scope), enabled: open && !!c && !!s });
  const auto = scope !== 'profiles' || (!!status.data && count >= status.data.threshold);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<((skipBackup: boolean) => void) | null>(null);

  const backUp = async () => {
    setBusy(true);
    try {
      qc.setQueryData(key, await bulkBackupApi.create(c!, s!, scope));
      return true;
    } catch (err) {
      setFailed(reasonOf(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    status: status.data,
    auto,
    failed,
    busy,
    /** The failure belongs to a deletion (not to "back up now"), so it can go on without the backup. */
    canSkip: failed !== null && pending.current !== null,
    async guard(run: (skipBackup: boolean) => void) {
      pending.current = run;
      setFailed(null);
      if (!auto || (await backUp())) run(false);
    },
    /** The deletion itself answered BACKUP_FAILED (the threshold was not loaded yet): shown like a failed step. */
    caught(err: any, run: (skipBackup: boolean) => void): boolean {
      if (err?.response?.data?.code !== 'BACKUP_FAILED') return false;
      pending.current = run;
      setFailed(err.response.data.details ?? reasonOf(err));
      return true;
    },
    skip() {
      setFailed(null);
      pending.current?.(true);
    },
    async now() {
      pending.current = null;
      setFailed(null);
      if (await backUp()) toast.success(t('components.backupStep.done'));
    },
    reset: () => {
      pending.current = null;
      setFailed(null);
    },
  };
}

export type BackupStepState = ReturnType<typeof useBackupStep>;

/** What the dialog says about the backup, and the way on when it failed. */
export function BackupStep({ step, disabled }: { step: BackupStepState; disabled?: boolean }) {
  const { t } = useTranslation();
  const last = step.status?.last;
  return (
    <div className="space-y-2 rounded-md border border-border px-3 py-2 text-sm">
      <p className="flex items-start gap-2">
        <DatabaseBackup className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          {step.auto ? t('components.backupStep.auto') : last
            ? t('components.backupStep.last', { time: new Date(last.createdAt).toLocaleString() })
            : t('components.backupStep.none')}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">{t('components.backupStep.scope')}</p>
      {!step.auto && !step.canSkip && (
        <Button type="button" size="sm" variant="outline" onClick={() => void step.now()} disabled={disabled || step.busy}>
          {step.busy ? t('components.confirmDialog.processing') : t('components.backupStep.now')}
        </Button>
      )}
      {step.failed && (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
          <p>{t('components.backupStep.failed', { reason: step.failed })}</p>
          {step.canSkip && (
            <Button type="button" size="sm" variant="destructive" onClick={step.skip} disabled={disabled}>
              {t('components.backupStep.skip')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
