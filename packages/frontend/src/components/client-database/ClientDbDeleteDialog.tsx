import { useTranslation } from 'react-i18next';
import type { ClientDbProfile } from '@ts6/common';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDeleteProfiles } from '@/hooks/use-client-database';
import { tsErrorMessage } from '@/lib/ts-errors';
import { summarizeNames } from './format';

interface ClientDbDeleteDialogProps {
  /** Mounted only while the dialog is open. */
  profiles: ClientDbProfile[];
  /** Database ids of the clients connected right now; TeamSpeak refuses to delete those. */
  onlineIds: Set<number>;
  onClose: () => void;
  /** Something was deleted; the page clears its row selection. */
  onDone: () => void;
}

export function ClientDbDeleteDialog({ profiles, onlineIds, onClose, onDone }: ClientDbDeleteDialogProps) {
  const { t } = useTranslation();
  const remove = useDeleteProfiles();

  const deletable = profiles.filter((p) => !onlineIds.has(p.cldbid));
  const connected = profiles.length - deletable.length;

  const submit = () => {
    remove.mutate(deletable.map((p) => p.cldbid), {
      onSuccess: (result) => {
        if (result.deleted.length > 0) toast.success(t('pages.clientDatabase.delete.done', { count: result.deleted.length }));
        // TeamSpeak can still refuse for a client that connected after the dialog opened.
        if (result.online.length > 0) toast.warning(t('pages.clientDatabase.delete.skippedOnline', { count: result.online.length }));
        if (result.failed.length > 0) {
          toast.error(t('pages.clientDatabase.delete.failedSome', { count: result.failed.length, message: result.failed[0].message }));
        }
        if (result.deleted.length > 0) onDone();
        onClose();
      },
      onError: (err) => toast.error(tsErrorMessage(err, t('pages.clientDatabase.delete.failed'), t)),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !remove.isPending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.clientDatabase.delete.title', { count: deletable.length || profiles.length })}</DialogTitle>
          <DialogDescription className="break-words">{summarizeNames(deletable.length > 0 ? deletable : profiles, 8, t)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>{t('pages.clientDatabase.delete.consequences', { count: deletable.length || profiles.length })}</p>
          <p className="text-muted-foreground">{t('pages.clientDatabase.delete.newProfile')}</p>
          {connected > 0 && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-400">
              {t('pages.clientDatabase.delete.connectedSkipped', { count: connected })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={remove.isPending}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={submit} disabled={deletable.length === 0 || remove.isPending}>
            <Trash2 className="h-4 w-4 mr-1" />
            {remove.isPending ? t('components.confirmDialog.processing') : t('pages.clientDatabase.delete.confirm', { count: deletable.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
