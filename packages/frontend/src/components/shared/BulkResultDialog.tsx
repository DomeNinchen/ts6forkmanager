import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import type { BulkOutcome } from '@ts6/common';
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

export function BulkResultDialog() {
  const { t } = useTranslation();
  const { title, outcomes, close } = useBulkResultStore();
  if (!outcomes) return null;
  const ok = outcomes.filter((o) => o.status === 'ok').length;
  const skipped = outcomes.filter((o) => o.status === 'skipped').length;
  const failed = outcomes.length - ok - skipped;
  const rest = outcomes.filter((o) => o.status !== 'ok');

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
        <ul className="max-h-72 space-y-2 overflow-auto text-sm">
          {rest.map((o) => (
            <li key={o.id} className="flex flex-col gap-0.5 rounded border border-border p-2">
              <div className="flex items-center gap-2">
                <Badge variant={o.status === 'failed' ? 'destructive' : 'warning'}>{t(`components.bulkResult.status.${o.status}`)}</Badge>
                <span className="break-all font-medium">{o.name}</span>
              </div>
              <span className="break-words text-muted-foreground">{why(o, t)}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={close}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
