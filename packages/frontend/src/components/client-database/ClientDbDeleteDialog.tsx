import { useTranslation } from 'react-i18next';
import { clientDbDeleteToBulk, type ClientDbProfile } from '@ts6/common';
import { BulkPreview, reportBulk, useBulkPreview } from '@/components/shared/BulkResultDialog';
import { clientDatabaseApi } from '@/api/client-database.api';
import { useServerStore } from '@/stores/server.store';
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
  const { selectedConfigId, selectedSid } = useServerStore();

  const deletable = profiles.filter((p) => !onlineIds.has(p.cldbid));
  const connected = profiles.length - deletable.length;
  // Several profiles: the first press shows what would happen (R9), the second deletes.
  const preview = useBulkPreview();
  const needsPreview = deletable.length > 1 && !preview.outcomes;
  const nameOf = (o: { id: number; name: string }) => profiles.find((p) => p.cldbid === o.id)?.nickname || o.name;

  const submit = () => {
    if (needsPreview) {
      preview.ask(() => clientDatabaseApi.removePreview(selectedConfigId!, selectedSid!, deletable.map((p) => p.cldbid)),
        (err) => toast.error(tsErrorMessage(err, t('pages.clientDatabase.delete.failed'), t)), nameOf);
      return;
    }
    remove.mutate(deletable.map((p) => p.cldbid), {
      onSuccess: (result) => {
        const name = (cldbid: number) => profiles.find((p) => p.cldbid === cldbid)?.nickname || `#${cldbid}`;
        // TeamSpeak can still refuse for a client that connected after the dialog opened.
        reportBulk(t('pages.clientDatabase.delete.title', { count: deletable.length }), t('pages.clientDatabase.delete.done', { count: result.deleted.length }),
          clientDbDeleteToBulk(result, name));
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
          {preview.outcomes && <BulkPreview outcomes={preview.outcomes} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={remove.isPending}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={submit} disabled={deletable.length === 0 || remove.isPending || preview.loading || preview.empty}>
            <Trash2 className="h-4 w-4 mr-1" />
            {remove.isPending || preview.loading ? t('components.confirmDialog.processing')
              : needsPreview ? t('components.bulkResult.preview.check') : t('pages.clientDatabase.delete.confirm', { count: deletable.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
