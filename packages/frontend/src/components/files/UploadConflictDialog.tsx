import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTransfers } from '@/stores/transfers.store';

/** "That file is already there - replace it?", for whichever upload is waiting on the answer. */
export function UploadConflictDialog() {
  const { t } = useTranslation();
  const conflictId = useTransfers((state) => state.conflictId);
  const name = useTransfers((state) => state.uploads.find((item) => item.id === state.conflictId)?.name);
  const resolveConflict = useTransfers((state) => state.resolveConflict);
  const [applyToAll, setApplyToAll] = useState(false);

  // Each new question starts unticked - "for all" is a decision made on purpose
  useEffect(() => {
    if (conflictId) setApplyToAll(false);
  }, [conflictId]);

  return (
    <Dialog open={!!conflictId} onOpenChange={(open) => { if (!open) resolveConflict('skip', false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.files.conflict.title')}</DialogTitle>
          <DialogDescription>{t('pages.files.conflict.description', { name })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Checkbox id="upload-conflict-all" checked={applyToAll} onCheckedChange={(value) => setApplyToAll(value === true)} />
          <Label htmlFor="upload-conflict-all" className="text-xs">{t('pages.files.conflict.applyToAll')}</Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => resolveConflict('skip', applyToAll)}>
            {t('pages.files.conflict.skip')}
          </Button>
          <Button onClick={() => resolveConflict('overwrite', applyToAll)}>
            {t('pages.files.conflict.overwrite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
