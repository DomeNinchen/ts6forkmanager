import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { checkFileName } from '@ts6/common';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn, formatBytes } from '@/lib/utils';
import { asciiName } from '@/lib/ascii-name';
import { dragCarriesFiles, readDroppedFiles } from '@/lib/dropped-files';
import { hasNonAscii, pathProblemMessage } from '@/lib/file-errors';
import { useTransfers, type UploadTarget } from '@/stores/transfers.store';

interface Entry {
  key: number;
  file: File;
  /** Upload under a plain ASCII name (only asked about where the name has umlauts or the like). */
  adjust: boolean;
}

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

interface UploadDialogProps {
  open: boolean;
  /** What the window starts with: the files dropped on the file list, or nothing. */
  initialFiles: File[];
  target: UploadTarget;
  channelName: string;
  maxUploadBytes?: number;
  onClose: () => void;
}

/**
 * The window every upload goes through: choose or drop files, see what will happen
 * to each of them, then start. A name with umlauts or other non-ASCII characters is
 * flagged right at its file - TeamSpeak clients may not be able to download such a
 * file afterwards - with the choice of uploading it under a plain ASCII name or as
 * it is. Nothing is sent before "Upload" is pressed.
 */
export function UploadDialog({ open, initialFiles, target, channelName, maxUploadBytes, onClose }: UploadDialogProps) {
  const { t } = useTranslation();
  const enqueueUploads = useTransfers((state) => state.enqueueUploads);

  const [entries, setEntries] = useState<Entry[]>([]);
  // What a file added from now on starts with; "Keep all names" turns it off for the rest of this window
  const [adjustByDefault, setAdjustByDefault] = useState(true);
  const [dragging, setDragging] = useState(false);
  const nextKey = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (files: File[]) => {
    setEntries((current) => {
      const fresh = files.filter((file, index) => (
        !current.some((entry) => sameFile(entry.file, file)) && files.findIndex((other) => sameFile(other, file)) === index
      ));
      return [...current, ...fresh.map((file) => ({ key: nextKey.current++, file, adjust: adjustByDefault }))];
    });
  };

  // Every time the window opens it starts afresh, with what was dropped on the list
  useEffect(() => {
    if (!open) return;
    setAdjustByDefault(true);
    setDragging(false);
    setEntries(initialFiles.map((file) => ({ key: nextKey.current++, file, adjust: true })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const rows = useMemo(() => {
    const taken = new Set<string>();
    return entries.map((entry) => {
      const flagged = hasNonAscii(entry.file.name);
      const name = flagged && entry.adjust ? asciiName(entry.file.name) : entry.file.name;
      let problem: string | null = null;
      const nameProblem = checkFileName(name);
      if (nameProblem) problem = pathProblemMessage(nameProblem, t);
      else if (maxUploadBytes !== undefined && entry.file.size > maxUploadBytes) {
        problem = t('pages.files.errors.tooLargeFor', { size: formatBytes(maxUploadBytes) });
      } else if (taken.has(name)) problem = t('pages.files.uploadDialog.duplicate');
      if (!problem) taken.add(name);
      return { entry, flagged, name, problem };
    });
  }, [entries, maxUploadBytes, t]);

  const ready = rows.filter((row) => !row.problem);
  const flaggedCount = rows.filter((row) => row.flagged).length;
  const totalSize = ready.reduce((sum, row) => sum + row.entry.file.size, 0);

  const setAdjust = (key: number, adjust: boolean) =>
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, adjust } : entry)));
  const setAllAdjust = (adjust: boolean) => {
    setAdjustByDefault(adjust);
    setEntries((current) => current.map((entry) => ({ ...entry, adjust })));
  };
  const remove = (key: number) => setEntries((current) => current.filter((entry) => entry.key !== key));

  const start = () => {
    if (ready.length === 0) return;
    enqueueUploads(target, ready.map((row) => ({ file: row.entry.file, name: row.name })), maxUploadBytes);
    onClose();
  };

  const handleDrop = (event: DragEvent) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    const { files, folders } = readDroppedFiles(event);
    if (folders > 0) toast.info(t('pages.files.foldersNotSupported'));
    add(files);
  };

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
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />

        <div
          className={cn(
            'flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 text-sm text-muted-foreground transition-colors',
            rows.length === 0 ? 'py-8' : 'py-3',
            dragging ? 'border-primary bg-primary/10 text-primary' : 'border-border',
          )}
        >
          {rows.length === 0 ? (
            <>
              <Upload className="h-5 w-5" />
              <span>{t('pages.files.uploadDialog.dropHint')}</span>
              <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                {t('pages.files.uploadDialog.choose')}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <span>{t('pages.files.uploadDialog.dropMore')}</span>
              <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                {t('pages.files.uploadDialog.addMore')}
              </Button>
            </div>
          )}
        </div>

        {flaggedCount > 0 && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {t('pages.files.uploadDialog.bannerTitle')}
            </div>
            <p className="text-muted-foreground">{t('pages.files.uploadDialog.banner', { count: flaggedCount })}</p>
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

        {rows.length > 0 && (
          <ul className="max-h-[40vh] divide-y divide-border/50 overflow-y-auto rounded-md border border-border">
            {rows.map(({ entry, flagged, name, problem }) => {
              const keepsNonAscii = flagged && !entry.adjust;
              return (
                <li key={entry.key} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <div className="mt-0.5 shrink-0">
                    {problem ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : keepsNonAscii ? (
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                    ) : (
                      <Check className="h-4 w-4 text-emerald-400" />
                    )}
                  </div>
                  <div className={cn('min-w-0 flex-1 space-y-1', problem && 'opacity-80')}>
                    <div className="flex items-baseline gap-2">
                      <span className={cn('truncate font-medium', problem && 'line-through')} title={name}>{name}</span>
                      <span className="shrink-0 font-mono-data text-xs text-muted-foreground">{formatBytes(entry.file.size)}</span>
                    </div>
                    {name !== entry.file.name && (
                      <p className="truncate text-xs text-muted-foreground" title={entry.file.name}>
                        {t('pages.files.uploadDialog.originalName', { name: entry.file.name })}
                      </p>
                    )}
                    {problem && <p className="text-xs text-destructive">{problem}</p>}
                    {flagged && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`upload-adjust-${entry.key}`}
                          checked={entry.adjust}
                          onCheckedChange={(value) => setAdjust(entry.key, value === true)}
                        />
                        <Label htmlFor={`upload-adjust-${entry.key}`} className="text-xs">
                          {t('pages.files.uploadDialog.adjustLabel')}
                        </Label>
                      </div>
                    )}
                    {keepsNonAscii && !problem && (
                      <p className="text-xs text-amber-400">{t('pages.files.uploadDialog.keepWarning')}</p>
                    )}
                  </div>
                  <button
                    onClick={() => remove(entry.key)}
                    className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title={t('pages.files.uploadDialog.remove')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter className="sm:items-center sm:justify-between sm:space-x-0">
          <p className="text-xs text-muted-foreground">
            {ready.length > 0 && t('pages.files.uploadDialog.summary', { count: ready.length, size: formatBytes(totalSize) })}
            {rows.length > ready.length && (
              <span className="block text-destructive">
                {t('pages.files.uploadDialog.leftOut', { count: rows.length - ready.length })}
              </span>
            )}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button onClick={start} disabled={ready.length === 0}>
              <Upload className="mr-1 h-4 w-4" />
              {ready.length > 0 ? t('pages.files.uploadDialog.upload', { count: ready.length }) : t('pages.files.uploadDialog.uploadEmpty')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
