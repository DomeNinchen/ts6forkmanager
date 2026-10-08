import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { connectionJournalApi } from '@/api/connection-journal.api';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** Whether the journal records, how long it keeps what it recorded, which TeamSpeak clients count, what is watched, and emptying it. */
export function JournalSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['connection-journal', 'settings'],
    queryFn: connectionJournalApi.getSettings,
  });
  const { data: tsStatus } = useQuery({
    queryKey: ['connection-journal', 'ts-status'],
    queryFn: connectionJournalApi.getTsStatus,
    // The state of the watching changes without anybody touching this page (a connection dropping, a login refused).
    refetchInterval: 10_000,
  });

  const [enabled, setEnabled] = useState(true);
  const [retentionDays, setRetentionDays] = useState('30');
  const [maxRows, setMaxRows] = useState('100000');
  const [recordQueryClients, setRecordQueryClients] = useState(false);
  const [recordOwnBots, setRecordOwnBots] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // The form follows what the server holds - first load, and after a save.
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setRetentionDays(String(data.retentionDays));
    setMaxRows(String(data.maxRows));
    setRecordQueryClients(data.recordQueryClients);
    setRecordOwnBots(data.recordOwnBots);
  }, [data]);

  const days = Number(retentionDays);
  const rows = Number(maxRows);
  const daysValid = data ? Number.isInteger(days) && days >= data.bounds.retentionMin && days <= data.bounds.retentionMax : false;
  const rowsValid = data ? Number.isInteger(rows) && rows >= data.bounds.maxRowsMin && rows <= data.bounds.maxRowsMax : false;
  const dirty =
    !!data &&
    (enabled !== data.enabled || days !== data.retentionDays || rows !== data.maxRows
      || recordQueryClients !== data.recordQueryClients || recordOwnBots !== data.recordOwnBots);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['connection-journal'] });

  const save = useMutation({
    mutationFn: () => connectionJournalApi.setSettings({ enabled, retentionDays: days, maxRows: rows, recordQueryClients, recordOwnBots }),
    onSuccess: (saved) => {
      qc.setQueryData(['connection-journal', 'settings'], saved);
      void invalidate();
      toast.success(t('pages.connectionJournal.settings.saved'));
    },
    onError: () => toast.error(t('pages.connectionJournal.settings.saveFailed')),
  });

  const clear = useMutation({
    mutationFn: connectionJournalApi.clear,
    onSuccess: ({ deletedCount }) => {
      void invalidate();
      setConfirmClear(false);
      toast.success(t('pages.connectionJournal.settings.cleared', { count: deletedCount }));
    },
    onError: () => toast.error(t('pages.connectionJournal.settings.clearFailed')),
  });

  if (isLoading) return <PageLoader />;
  if (isError || !data) return <p className="text-sm text-destructive">{t('pages.connectionJournal.loadFailed')}</p>;

  return (
    <div className="max-w-xl space-y-4">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.connectionJournal.settings.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{t('pages.connectionJournal.settings.description')}</p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.connectionJournal.settings.enabledLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.connectionJournal.settings.enabledHint')}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="journal-enabled" />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.connectionJournal.settings.queryClientsLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.connectionJournal.settings.queryClientsHint')}</p>
            </div>
            <Switch checked={recordQueryClients} onCheckedChange={setRecordQueryClients} data-testid="journal-query-clients" />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.connectionJournal.settings.ownBotsLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.connectionJournal.settings.ownBotsHint')}</p>
            </div>
            <Switch checked={recordOwnBots} onCheckedChange={setRecordOwnBots} data-testid="journal-own-bots" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="journal-days">{t('pages.connectionJournal.settings.retentionLabel')}</Label>
              <Input
                id="journal-days"
                type="number"
                min={data.bounds.retentionMin}
                max={data.bounds.retentionMax}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                aria-invalid={!daysValid}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('pages.connectionJournal.settings.retentionHint', { min: data.bounds.retentionMin, max: data.bounds.retentionMax })}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="journal-rows">{t('pages.connectionJournal.settings.maxRowsLabel')}</Label>
              <Input
                id="journal-rows"
                type="number"
                min={data.bounds.maxRowsMin}
                max={data.bounds.maxRowsMax}
                value={maxRows}
                onChange={(e) => setMaxRows(e.target.value)}
                aria-invalid={!rowsValid}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('pages.connectionJournal.settings.maxRowsHint', {
                  min: data.bounds.maxRowsMin.toLocaleString(),
                  max: data.bounds.maxRowsMax.toLocaleString(),
                })}
              </p>
            </div>
          </div>

          <Button onClick={() => save.mutate()} disabled={!dirty || !daysValid || !rowsValid || save.isPending}>
            {t('common.save')}
          </Button>
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.connectionJournal.settings.watchedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('pages.connectionJournal.settings.watchedDescription')}</p>
          {!tsStatus || tsStatus.length === 0 ? (
            <p className="text-xs" data-testid="journal-watched-empty">{t('pages.connectionJournal.settings.watchedNone')}</p>
          ) : (
            <ul className="space-y-1.5" data-testid="journal-watched">
              {tsStatus.map((s) => (
                <li key={`${s.configId}:${s.virtualServerId}`} className="rounded-md border px-3 py-2 text-xs space-y-1" data-testid="journal-watched-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.connectionName}</span>
                    {s.virtualServerId > 0 && (
                      <span className="text-muted-foreground">{t('pages.connectionJournal.ts.virtualServer', { id: s.virtualServerId })}</span>
                    )}
                    <Badge variant={s.mode === 'events' ? 'success' : s.mode === 'polling' ? 'secondary' : 'warning'}>
                      {t(`pages.connectionJournal.settings.mode.${s.mode}`)}
                    </Badge>
                    {s.virtualServerId > 0 && (
                      <span className="text-muted-foreground">{t('pages.connectionJournal.settings.openSessions', { count: s.openSessions })}</span>
                    )}
                  </div>
                  {s.problem && <p className="text-amber-500">{t(`pages.connectionJournal.settings.problem.${s.problem}`)}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.connectionJournal.settings.storedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs" data-testid="journal-stored">
            {t('pages.connectionJournal.settings.stored', { count: data.entryCount })}
            {data.oldestAt && <> {t('pages.connectionJournal.settings.oldest', { date: new Date(data.oldestAt).toLocaleString() })}</>}
          </p>
          <Button variant="destructive" size="sm" onClick={() => setConfirmClear(true)} disabled={data.entryCount === 0}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> {t('pages.connectionJournal.settings.clear')}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('pages.connectionJournal.settings.clearTitle')}
        description={t('pages.connectionJournal.settings.clearDescription', { count: data.entryCount })}
        confirmLabel={t('pages.connectionJournal.settings.clear')}
        destructive
        loading={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </div>
  );
}
