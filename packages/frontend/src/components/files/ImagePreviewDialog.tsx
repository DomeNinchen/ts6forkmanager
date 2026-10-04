import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { joinRepositoryPath, type ServerFileEntry } from '@ts6/common';
import { filesApi } from '@/api/files.api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/utils';
import { previewErrorMessage } from '@/lib/file-errors';

// How long a picture has to stay on screen before it is asked for: flicking through
// a folder with the arrow keys then asks the server only for the one that stays.
const SETTLE_MS = 150;

interface ImagePreviewDialogProps {
  configId: number;
  sid: number;
  cid: number;
  /** The folder the pictures are in. */
  directory: string;
  /** The pictures of that folder that can be previewed, in the order the list shows them. */
  images: ServerFileEntry[];
  /** Name of the picture that is open; null while the window is closed. */
  current: string | null;
  onChange: (name: string) => void;
  onClose: () => void;
  onDownload: (entry: ServerFileEntry) => void;
}

/**
 * The picture of a file, large, with the pictures around it one arrow away. What
 * comes from the server has been checked there by its bytes (PNG, JPEG, GIF, BMP or
 * WebP, within the size limits), never by its name.
 */
export function ImagePreviewDialog({
  configId, sid, cid, directory, images, current, onChange, onClose, onDownload,
}: ImagePreviewDialogProps) {
  const { t } = useTranslation();
  const index = current ? images.findIndex((image) => image.name === current) : -1;
  const entry = index >= 0 ? images[index] : null;

  // The picture that has settled on screen; the first one is asked for at once
  const [wanted, setWanted] = useState<ServerFileEntry | null>(null);
  useEffect(() => {
    if (!entry) return setWanted(null);
    if (!wanted) return setWanted(entry);
    if (wanted.name === entry.name && wanted.modified === entry.modified && wanted.size === entry.size) return;
    const timer = setTimeout(() => setWanted(entry), SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.name, entry?.modified, entry?.size]);

  // The file may be gone from the list (deleted, moved, replaced by a bigger one)
  useEffect(() => {
    if (current && index < 0) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, index]);

  const { data: blob, error, isFetching, refetch } = useQuery({
    // modified and size are part of the key: a replaced file is a new picture
    queryKey: ['file-preview', configId, sid, cid, directory, wanted?.name, wanted?.modified, wanted?.size],
    queryFn: ({ signal }) => filesApi.preview(configId, sid, cid, joinRepositoryPath(directory, wanted!.name), signal),
    enabled: !!wanted,
    retry: false,
    staleTime: Infinity,
    // A few pictures stay for stepping back; they are not kept for long
    gcTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  const [pixels, setPixels] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => setPixels(null), [url]);

  const settled = !!entry && !!wanted && wanted.name === entry.name && wanted.modified === entry.modified && wanted.size === entry.size;
  const loading = !entry || !settled || (isFetching && !blob);
  const failed = settled && !isFetching && !!error;

  // The arrow keys step through the folder's pictures
  useEffect(() => {
    if (!entry) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const next = images[index + (event.key === 'ArrowRight' ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      onChange(next.name);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry, images, index, onChange]);

  const previous = index > 0 ? images[index - 1] : null;
  const next = index >= 0 && index < images.length - 1 ? images[index + 1] : null;

  return (
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader className="pr-6">
          <DialogTitle className="truncate text-base" title={entry?.name}>{entry?.name}</DialogTitle>
          <DialogDescription>
            {t('pages.files.preview.position', { index: index + 1, total: images.length })}
            {entry && ` - ${formatBytes(entry.size)}`}
            {pixels && ` - ${t('pages.files.preview.dimensions', pixels)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex h-[60vh] items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
          {failed ? (
            <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
              <p className="text-sm text-muted-foreground">{previewErrorMessage(error, t)}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>{t('pages.files.preview.retry')}</Button>
            </div>
          ) : loading || !url ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('pages.files.preview.loading')}
            </div>
          ) : (
            <img
              key={url}
              src={url}
              alt={entry?.name}
              className="max-h-full max-w-full object-contain"
              onLoad={(event) => setPixels({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            />
          )}

          <Button
            size="icon"
            variant="secondary"
            className="absolute left-2 top-1/2 h-9 w-9 -translate-y-1/2"
            disabled={!previous}
            onClick={() => previous && onChange(previous.name)}
            title={t('pages.files.preview.previous')}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2"
            disabled={!next}
            onClick={() => next && onChange(next.name)}
            title={t('pages.files.preview.next')}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => entry && onDownload(entry)}>
            <Download className="mr-1 h-4 w-4" /> {t('pages.files.download')}
          </Button>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
