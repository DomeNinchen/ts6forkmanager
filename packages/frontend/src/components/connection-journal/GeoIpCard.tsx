import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Trash2, Upload } from 'lucide-react';
import { GEOIP_EDITIONS, type GeoIpEdition } from '@ts6/common';
import { connectionJournalApi } from '@/api/connection-journal.api';
import { formatBytes } from '@/lib/utils';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

/** The country lookup behind the journal: what is installed, getting one (DB-IP's free database or a file of the admin's own), and the monthly update. */
export function GeoIpCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['connection-journal', 'geoip'],
    queryFn: connectionJournalApi.getGeoIp,
    // A download and the look-up of the older entries run on the server; follow them closely while they do.
    refetchInterval: (query) => (query.state.data && (query.state.data.state !== 'idle' || query.state.data.backfill.running) ? 1000 : 15_000),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['connection-journal'] });

  // A download or the look-up of the older entries just finished on the server: the lists and the country filter have more to show now.
  const working = !!status && (status.state !== 'idle' || status.backfill.running);
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working) void refresh();
    wasWorking.current = working;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);
  const failed = (message: string) => (err: any) => {
    const code = err?.response?.data?.code as string | undefined;
    toast.error(code ? t(`pages.connectionJournal.geoip.errors.${code}`, { detail: err.response.data.error ?? '' }) : message);
  };

  const settings = useMutation({
    mutationFn: connectionJournalApi.setGeoIpSettings,
    onSuccess: (saved) => { qc.setQueryData(['connection-journal', 'geoip'], saved); void refresh(); },
    onError: failed(t('pages.connectionJournal.geoip.saveFailed')),
  });
  const download = useMutation({
    mutationFn: () => connectionJournalApi.downloadGeoIp(),
    onSuccess: (started) => { qc.setQueryData(['connection-journal', 'geoip'], started); },
    onError: failed(t('pages.connectionJournal.geoip.downloadFailed')),
  });
  const uploadFile = useMutation({
    mutationFn: (file: File) => connectionJournalApi.uploadGeoIp(file),
    onSuccess: (saved) => {
      qc.setQueryData(['connection-journal', 'geoip'], saved);
      void refresh();
      toast.success(t('pages.connectionJournal.geoip.uploaded'));
    },
    onError: failed(t('pages.connectionJournal.geoip.uploadFailed')),
  });
  const remove = useMutation({
    mutationFn: connectionJournalApi.removeGeoIp,
    onSuccess: (saved) => {
      qc.setQueryData(['connection-journal', 'geoip'], saved);
      setConfirmRemove(false);
      void refresh();
      toast.success(t('pages.connectionJournal.geoip.removed'));
    },
    onError: failed(t('pages.connectionJournal.geoip.removeFailed')),
  });

  if (!status) return null;

  const busy = status.state !== 'idle';
  const percent = status.progress?.totalBytes ? Math.min(100, Math.round((status.progress.receivedBytes / status.progress.totalBytes) * 100)) : null;
  const sameEditionInstalled = status.installed && status.source === 'dbip' && status.edition === status.selectedEdition;
  const label = (edition: GeoIpEdition | 'custom' | null) => (edition ? t(`pages.connectionJournal.geoip.edition.${edition}`) : '');

  return (
    <Card className="card-hero" data-testid="geoip-card">
      <CardHeader>
        <CardTitle className="text-sm font-medium">{t('pages.connectionJournal.geoip.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('pages.connectionJournal.geoip.description')}</p>

        {status.installed ? (
          <div className="rounded-md border px-3 py-2 text-xs space-y-1" data-testid="geoip-installed">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{status.databaseType}</span>
              <Badge variant="success">{status.source === 'dbip' ? t('pages.connectionJournal.geoip.sourceDbip') : t('pages.connectionJournal.geoip.sourceCustom')}</Badge>
              {status.version && <span className="text-muted-foreground">{t('pages.connectionJournal.geoip.release', { version: status.version })}</span>}
            </div>
            <div className="text-muted-foreground">
              {status.builtAt && <>{t('pages.connectionJournal.geoip.built', { date: new Date(status.builtAt).toLocaleDateString() })} · </>}
              {status.sizeBytes !== null && <>{formatBytes(status.sizeBytes)} · </>}
              {status.installedAt && t('pages.connectionJournal.geoip.installedAt', { date: new Date(status.installedAt).toLocaleString() })}
            </div>
          </div>
        ) : (
          <p className="text-xs" data-testid="geoip-none">{t('pages.connectionJournal.geoip.none')}</p>
        )}

        {status.backfill.running && (
          <div className="space-y-1" data-testid="geoip-backfill">
            <p className="text-xs text-muted-foreground">{t('pages.connectionJournal.geoip.backfill', { done: status.backfill.done, total: status.backfill.total })}</p>
            <Progress value={status.backfill.total ? Math.round((status.backfill.done / status.backfill.total) * 100) : 0} />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">{t('pages.connectionJournal.geoip.editionLabel')}</Label>
          <Select
            value={status.selectedEdition}
            onValueChange={(v) => settings.mutate({ edition: v as GeoIpEdition, autoUpdate: status.autoUpdate })}
            disabled={busy || settings.isPending}
          >
            <SelectTrigger className="h-9 w-[260px]" data-testid="geoip-edition"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GEOIP_EDITIONS.map((e) => <SelectItem key={e} value={e}>{label(e)}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t(`pages.connectionJournal.geoip.editionHint.${status.selectedEdition}`)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => download.mutate()} disabled={busy || download.isPending} data-testid="geoip-download">
            <Download className="h-3.5 w-3.5 mr-1" />
            {sameEditionInstalled ? t('pages.connectionJournal.geoip.updateNow') : t('pages.connectionJournal.geoip.downloadNow', { edition: label(status.selectedEdition) })}
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy || uploadFile.isPending}>
            <Upload className="h-3.5 w-3.5 mr-1" /> {t('pages.connectionJournal.geoip.upload')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".mmdb,.gz,application/gzip,application/octet-stream"
            className="hidden"
            data-testid="geoip-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) uploadFile.mutate(file);
            }}
          />
          {status.installed && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> {t('pages.connectionJournal.geoip.remove')}
            </Button>
          )}
        </div>

        {busy && (
          <div className="space-y-1" data-testid="geoip-progress">
            <p className="text-xs text-muted-foreground">
              {status.state === 'downloading'
                ? t('pages.connectionJournal.geoip.downloading', {
                    received: formatBytes(status.progress?.receivedBytes ?? 0),
                    total: status.progress?.totalBytes ? formatBytes(status.progress.totalBytes) : '?',
                  })
                : t('pages.connectionJournal.geoip.installing')}
            </p>
            {percent !== null && <Progress value={percent} />}
          </div>
        )}

        {status.lastError && !busy && (
          <p className="text-xs text-destructive" data-testid="geoip-error">
            {t(`pages.connectionJournal.geoip.errors.${status.lastError.code}`, { detail: status.lastError.detail })}
          </p>
        )}

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-xs">{t('pages.connectionJournal.geoip.autoUpdateLabel')}</Label>
            <p className="text-[11px] text-muted-foreground">{t('pages.connectionJournal.geoip.autoUpdateHint')}</p>
          </div>
          <Switch
            checked={status.autoUpdate}
            onCheckedChange={(v) => settings.mutate({ edition: status.selectedEdition, autoUpdate: v })}
            disabled={settings.isPending}
            data-testid="geoip-auto-update"
          />
        </div>

        {status.lastCheckAt && (
          <p className="text-[11px] text-muted-foreground">{t('pages.connectionJournal.geoip.lastCheck', { date: new Date(status.lastCheckAt).toLocaleString() })}</p>
        )}
        <p className="text-[11px] text-muted-foreground">{t('pages.connectionJournal.geoip.privacy')}</p>
      </CardContent>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('pages.connectionJournal.geoip.removeTitle')}
        description={t('pages.connectionJournal.geoip.removeDescription')}
        confirmLabel={t('pages.connectionJournal.geoip.remove')}
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </Card>
  );
}
