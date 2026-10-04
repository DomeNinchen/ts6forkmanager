import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FolderUp, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn, formatBytes } from '@/lib/utils';
import { dragCarriesFiles, readDroppedFiles, type DroppedFiles } from '@/lib/dropped-files';
import {
  MAX_UPLOAD_ITEMS, addToGroups, countItems, itemsFromFiles, readyItems, resolveGroups,
  type PickGroup, type PickedItem,
} from '@/lib/upload-tree';
import { useTransfers, type UploadTarget } from '@/stores/transfers.store';
import { UploadGroupRow } from './UploadGroupRow';

// `webkitdirectory` turns a file input into a folder picker. It is not in React's
// types, but every current browser takes it (as the attribute, with no value).
const FOLDER_INPUT = { webkitdirectory: '' } as Record<string, string>;

interface UploadDialogProps {
  open: boolean;
  /** What the window starts with: what was dropped on the file list, or nothing. */
  initialItems: PickedItem[];
  target: UploadTarget;
  channelName: string;
  maxUploadBytes?: number;
  onClose: () => void;
}

/**
 * The window every upload goes through: choose or drop files and folders, see what
 * will happen to each of them, then start. A name with umlauts or other non-ASCII
 * characters is flagged right at its file or folder - TeamSpeak clients may not be
 * able to download such a file afterwards - with the choice of uploading it under
 * a plain ASCII name or as it is; for a folder the choice covers everything in it.
 * Nothing is sent before "Upload" is pressed.
 */
export function UploadDialog({ open, initialItems, target, channelName, maxUploadBytes, onClose }: UploadDialogProps) {
  const { t } = useTranslation();
  const enqueueUploads = useTransfers((state) => state.enqueueUploads);

  const [groups, setGroups] = useState<PickGroup[]>([]);
  // What something added from now on starts with; "Keep all names" turns it off for the rest of this window
  const [adjustByDefault, setAdjustByDefault] = useState(true);
  const [dragging, setDragging] = useState(false);
  // Reading what was dropped can take a moment when it is a big folder
  const [reading, setReading] = useState(0);
  const nextKey = useRef(1);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  // The list as of right now: a folder being read when more is added must not be answered with a stale one
  const current = useRef<PickGroup[]>([]);

  const commit = (next: PickGroup[]) => {
    current.current = next;
    setGroups(next);
  };

  const add = (picked: PickedItem[]) => {
    if (picked.length === 0) return;
    const next = addToGroups(current.current, picked, adjustByDefault, () => nextKey.current++);
    if (countItems(next) > MAX_UPLOAD_ITEMS) {
      toast.error(t('pages.files.uploadDialog.tooMany', { max: MAX_UPLOAD_ITEMS }));
      return;
    }
    commit(next);
  };

  // Every time the window opens it starts afresh, with what was dropped on the list
  useEffect(() => {
    if (!open) return;
    setAdjustByDefault(true);
    setDragging(false);
    commit(addToGroups([], initialItems, true, () => nextKey.current++));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const resolved = useMemo(
    () => resolveGroups(groups, { directory: target.directory, maxUploadBytes }),
    [groups, target.directory, maxUploadBytes],
  );

  const flaggedGroups = resolved.filter((entry) => entry.flagged > 0).length;
  const fileCount = resolved.reduce((sum, entry) => sum + entry.files, 0);
  const emptyFolderCount = resolved.reduce((sum, entry) => sum + entry.emptyFolders, 0);
  const totalSize = resolved.reduce((sum, entry) => sum + entry.bytes, 0);
  const leftOut = resolved.reduce((sum, entry) => sum + (entry.items.length - entry.ready.length), 0);
  const readyCount = fileCount + emptyFolderCount;

  const setAdjust = (key: number, adjust: boolean) =>
    commit(current.current.map((group) => (group.key === key ? { ...group, adjust } : group)));
  const setAllAdjust = (adjust: boolean) => {
    setAdjustByDefault(adjust);
    commit(current.current.map((group) => ({ ...group, adjust })));
  };
  const remove = (key: number) => commit(current.current.filter((group) => group.key !== key));

  const start = () => {
    if (readyCount === 0) return;
    enqueueUploads(target, readyItems(resolved), maxUploadBytes);
    onClose();
  };

  const addDropped = async (dropped: Promise<DroppedFiles>) => {
    setReading((count) => count + 1);
    try {
      const { items, tooMany } = await dropped;
      if (tooMany) toast.error(t('pages.files.uploadDialog.tooMany', { max: MAX_UPLOAD_ITEMS }));
      else add(items);
    } catch {
      toast.error(t('pages.files.uploadDialog.readFailed'));
    } finally {
      setReading((count) => count - 1);
    }
  };

  const handleDrop = (event: DragEvent) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    void addDropped(readDroppedFiles(event));
  };

  const chooseButtons = (more: boolean) => (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button size="sm" variant="outline" onClick={() => filesInput.current?.click()}>
        <Upload className="mr-1 h-3.5 w-3.5" />
        {more ? t('pages.files.uploadDialog.addMore') : t('pages.files.uploadDialog.choose')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => folderInput.current?.click()}>
        <FolderUp className="mr-1 h-3.5 w-3.5" />
        {more ? t('pages.files.uploadDialog.addFolder') : t('pages.files.uploadDialog.chooseFolder')}
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent
        className="max-w-2xl"
        onDragOver={(event) => {
          if (!dragCarriesFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <DialogHeader>
          <DialogTitle>{t('pages.files.uploadDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('pages.files.uploadDialog.description', { channel: channelName, path: target.directory })}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={filesInput}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            add(itemsFromFiles(Array.from(event.target.files ?? [])));
            event.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          {...FOLDER_INPUT}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // The folder picker only reports files, so a folder with none in it comes back as nothing at all
            if (files.length === 0) toast.info(t('pages.files.uploadDialog.nothingInFolder'));
            else add(itemsFromFiles(files));
            event.target.value = '';
          }}
        />

        <div
          className={cn(
            'flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 text-sm text-muted-foreground transition-colors',
            groups.length === 0 ? 'py-8' : 'py-3',
            dragging ? 'border-primary bg-primary/10 text-primary' : 'border-border',
          )}
        >
          {reading > 0 ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('pages.files.uploadDialog.reading')}</span>
            </div>
          ) : groups.length === 0 ? (
            <>
              <Upload className="h-5 w-5" />
              <span>{t('pages.files.uploadDialog.dropHint')}</span>
              {chooseButtons(false)}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span>{t('pages.files.uploadDialog.dropMore')}</span>
              {chooseButtons(true)}
            </div>
          )}
        </div>

        {flaggedGroups > 0 && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {t('pages.files.uploadDialog.bannerTitle')}
            </div>
            <p className="text-muted-foreground">{t('pages.files.uploadDialog.banner', { count: flaggedGroups })}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setAllAdjust(true)}>
                {t('pages.files.uploadDialog.adjustAll')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAllAdjust(false)}>
                {t('pages.files.uploadDialog.keepAll')}
              </Button>
            </div>
          </div>
        )}

        {resolved.length > 0 && (
          <ul className="max-h-[40vh] divide-y divide-border/50 overflow-y-auto rounded-md border border-border">
            {resolved.map((entry) => (
              <UploadGroupRow
                key={entry.group.key}
                resolved={entry}
                maxUploadBytes={maxUploadBytes}
                onAdjust={setAdjust}
                onRemove={remove}
              />
            ))}
          </ul>
        )}

        <DialogFooter className="sm:items-center sm:justify-between sm:space-x-0">
          <p className="text-xs text-muted-foreground">
            {fileCount > 0 && t('pages.files.uploadDialog.summary', { count: fileCount, size: formatBytes(totalSize) })}
            {leftOut > 0 && (
              <span className="block text-destructive">{t('pages.files.uploadDialog.leftOut', { count: leftOut })}</span>
            )}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button onClick={start} disabled={readyCount === 0}>
              <Upload className="mr-1 h-4 w-4" />
              {fileCount > 0
                ? t('pages.files.uploadDialog.upload', { count: fileCount })
                : emptyFolderCount > 0
                  ? t('pages.files.uploadDialog.makeFolders', { count: emptyFolderCount })
                  : t('pages.files.uploadDialog.uploadEmpty')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
