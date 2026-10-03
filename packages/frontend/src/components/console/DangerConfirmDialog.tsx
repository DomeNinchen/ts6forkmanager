import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { DangerReason } from '@ts6/common';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DangerConfirmDialogProps {
  open: boolean;
  /** The command to be confirmed, as the backend names it (lowercase). */
  command: string;
  reason: DangerReason | null;
  /** The command line as it will be sent, with secret values already hidden. */
  displayLine: string;
  /** On which server and virtual server it will run. */
  target: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A dangerous command does not run on a click: the admin types its name, so the
 * confirmation can not be a reflex. The backend checks the same name again.
 */
export function DangerConfirmDialog({ open, command, reason, displayLine, target, loading, onConfirm, onCancel }: DangerConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open, command]);

  const matches = typed.trim().toLowerCase() === command;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !loading && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> {t('pages.console.danger.title', { command })}
          </DialogTitle>
          <DialogDescription>{reason ? t(`pages.console.danger.reasons.${reason}`) : t('pages.console.danger.generic')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">{t('pages.console.danger.willRun', { target })}</div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
              {displayLine}
            </pre>
          </div>
          <div>
            <label htmlFor="danger-confirm" className="mb-1 block text-xs text-muted-foreground">
              {t('pages.console.danger.typeToConfirm', { command })}
            </label>
            <Input
              id="danger-confirm"
              value={typed}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder={command}
              disabled={loading}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches && !loading) onConfirm();
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={!matches || loading}>
            {loading ? t('components.confirmDialog.processing') : t('pages.console.danger.run', { command })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
