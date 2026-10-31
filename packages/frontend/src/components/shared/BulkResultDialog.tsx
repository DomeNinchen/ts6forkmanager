import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import type { BulkOutcome, BulkResult } from '@ts6/common';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBulkResultStore } from '@/stores/bulk-result.store';

/**
 * Reports a bulk action (R9): a toast when every target went through, otherwise the result
 * dialog with how many did and, for each of the others, why not.
 */
export function reportBulk(title: string, okText: string, outcomes: BulkOutcome[]): void {
  if (outcomes.every((o) => o.status === 'ok')) toast.success(okText);
  else useBulkResultStore.getState().show(title, outcomes);
}

/** Outcomes of a loop of single requests run by the page itself (Promise.allSettled), with the error text each one got. */
export function settledOutcomes(
  targets: Array<{ id: number; name: string }>,
  results: PromiseSettledResult<unknown>[],
  errorText: (err: unknown) => string,
): BulkOutcome[] {
  return targets.map((target, i) => {
    const r = results[i];
    return r.status === 'fulfilled' ? { ...target, status: 'ok' } : { ...target, status: 'failed', message: errorText(r.reason) };
  });
}

function why(o: BulkOutcome, t: TFunction): string {
  return o.reason ? t(`components.bulkResult.reason.${o.reason}`) : o.message || t('components.bulkResult.unknownError');
}

/** The targets that did not (or would not) go through, each with its reason. */
function OutcomeList({ outcomes, preview = false }: { outcomes: BulkOutcome[]; preview?: boolean }) {
  const { t } = useTranslation();
  const rest = outcomes.filter((o) => o.status !== 'ok');
  if (rest.length === 0) return null;
  return (
    <ul className="max-h-72 space-y-2 overflow-auto text-sm">
      {rest.map((o, i) => (
        <li key={`${o.id}-${i}`} className="flex flex-col gap-0.5 rounded border border-border p-2">
          <div className="flex items-center gap-2">
            <Badge variant={o.status === 'failed' ? 'destructive' : 'warning'}>{t(preview ? 'components.bulkResult.preview.skip' : `components.bulkResult.status.${o.status}`)}</Badge>
            <span className="break-all font-medium">{o.name}</span>
          </div>
          <span className="break-words text-muted-foreground">{why(o, t)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The preview step of a bulk dialog (R9), used when more than one target is picked: the first
 * press asks the backend what would happen (same route, nothing runs), the second runs it.
 * Changing an input that the outcome depends on must call `reset`.
 */
export function useBulkPreview() {
  const [outcomes, setOutcomes] = useState<BulkOutcome[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ask = (load: () => Promise<BulkResult>, onError: (err: unknown) => void, name?: (o: BulkOutcome) => string) => {
    setLoading(true);
    load()
      .then((r) => setOutcomes(name ? r.outcomes.map((o) => ({ ...o, name: name(o) })) : r.outcomes))
      .catch(onError)
      .finally(() => setLoading(false));
  };
  /** Nothing would run: the confirm button stays disabled. */
  const empty = outcomes !== null && !outcomes.some((o) => o.status === 'ok');
  return { outcomes, loading, empty, ask, reset: () => setOutcomes(null) };
}

/** What the preview found: how many targets would be acted on, and every one that would be skipped. */
export function BulkPreview({ outcomes }: { outcomes: BulkOutcome[] }) {
  const { t } = useTranslation();
  const ok = outcomes.filter((o) => o.status === 'ok').length;
  return (
    <div className="space-y-2" data-testid="bulk-preview">
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
        {ok === 0 ? t('components.bulkResult.preview.nothing') : t('components.bulkResult.preview.summary', { ok, total: outcomes.length })}
      </p>
      <OutcomeList outcomes={outcomes} preview />
    </div>
  );
}

export function BulkResultDialog() {
  const { t } = useTranslation();
  const { title, outcomes, close } = useBulkResultStore();
  if (!outcomes) return null;
  const ok = outcomes.filter((o) => o.status === 'ok').length;
  const skipped = outcomes.filter((o) => o.status === 'skipped').length;
  const failed = outcomes.length - ok - skipped;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent data-testid="bulk-result">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t('components.bulkResult.summary', { ok, total: outcomes.length })}
            {' '}
            {t('components.bulkResult.counts', { skipped, failed })}
          </DialogDescription>
        </DialogHeader>
        <OutcomeList outcomes={outcomes} />
        <DialogFooter>
          <Button onClick={close}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
