import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Ban, Check, Clock, Loader2, SkipForward, Upload, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn, formatBytes } from '@/lib/utils';
import { useTransfers, type UploadItem, type UploadStatus } from '@/stores/transfers.store';

const FINISHED: UploadStatus[] = ['done', 'skipped', 'error', 'canceled'];

function StatusIcon({ status }: { status: UploadStatus }) {
  const className = 'h-4 w-4 shrink-0';
  switch (status) {
    case 'done':
      return <Check className={cn(className, 'text-emerald-400')} />;
    case 'error':
      return <AlertTriangle className={cn(className, 'text-destructive')} />;
    case 'skipped':
      return <SkipForward className={cn(className, 'text-muted-foreground')} />;
    case 'canceled':
      return <Ban className={cn(className, 'text-muted-foreground')} />;
    case 'queued':
      return <Clock className={cn(className, 'text-muted-foreground')} />;
    case 'conflict':
      return <AlertTriangle className={cn(className, 'text-amber-400')} />;
    default:
      return <Loader2 className={cn(className, 'text-primary animate-spin')} />;
  }
}

function TransferRow({ item }: { item: UploadItem }) {
  const { t } = useTranslation();
  const cancelUpload = useTransfers((state) => state.cancelUpload);
  const finished = FINISHED.includes(item.status);
  const percent = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0;

  let label: string;
  switch (item.status) {
    case 'queued':
      label = t('pages.files.transfers.queued');
      break;
    case 'preparing':
      label = t('pages.files.transfers.preparing');
      break;
    case 'conflict':
      label = t('pages.files.transfers.waitingForAnswer');
      break;
    case 'uploading':
      // Everything has left the browser, but the server is still passing it on to TeamSpeak
      label = item.loaded >= item.size && item.size > 0
        ? t('pages.files.transfers.finishing')
        : `${formatBytes(item.loaded)} / ${formatBytes(item.size)}`;
      break;
    case 'done':
      label = formatBytes(item.size);
      break;
    case 'skipped':
      label = t('pages.files.transfers.skipped');
      break;
    case 'canceled':
      label = t('pages.files.transfers.canceled');
      break;
    default:
      label = t('pages.files.transfers.failed');
  }

  return (
    <div className="px-4 py-2 space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <StatusIcon status={item.status} />
        <span className="truncate flex-1" title={item.path}>{item.name}</span>
        <span className="text-xs text-muted-foreground font-mono-data shrink-0">{label}</span>
        {!finished && (
          <button
            onClick={() => cancelUpload(item.id)}
            className="p-1 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={t('common.cancel')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {item.status === 'uploading' && <Progress value={percent} />}
      {item.status === 'error' && item.error && <p className="text-xs text-destructive">{item.error}</p>}
    </div>
  );
}

/** Every upload of the selected server, running or finished, with a way to call one off. */
export function TransferPanel({ configId, sid }: { configId: number; sid: number }) {
  const { t } = useTranslation();
  const uploads = useTransfers((state) => state.uploads);
  const clearFinished = useTransfers((state) => state.clearFinished);
  const items = useMemo(
    () => uploads.filter((item) => item.configId === configId && item.sid === sid),
    [uploads, configId, sid],
  );

  if (items.length === 0) return null;

  return (
    <Card className="card-hero">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" /> {t('pages.files.transfers.title')}
          </CardTitle>
          {items.some((item) => FINISHED.includes(item.status)) && (
            <Button variant="ghost" size="sm" onClick={clearFinished}>
              {t('pages.files.transfers.clearFinished')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
          {items.map((item) => (
            <TransferRow key={item.id} item={item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
