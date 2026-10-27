import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { changeLogApi } from '@/api/change-log.api';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** Whether the change log records, whether it keeps the address and copies to the TeamSpeak log, how long it keeps rows, and emptying it. */
export function ChangeLogSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['change-log', 'settings'], queryFn: changeLogApi.getSettings });

  const [enabled, setEnabled] = useState(true);
  const [recordIp, setRecordIp] = useState(true);
  const [writeToTsLog, setWriteToTsLog] = useState(false);
  const [retentionDays, setRetentionDays] = useState('30');
  const [maxRows, setMaxRows] = useState('100000');
  const [confirmClear, setConfirmClear] = useState(false);

  // The form follows what the server holds - first load, and after a save.
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setRecordIp(data.recordIp);
    setWriteToTsLog(data.writeToTsLog);
    setRetentionDays(String(data.retentionDays));
    setMaxRows(String(data.maxRows));
  }, [data]);

  const days = Number(retentionDays);
  const rows = Number(maxRows);
  const daysValid = data ? Number.isInteger(days) && days >= data.bounds.retentionMin && days <= data.bounds.retentionMax : false;
  const rowsValid = data ? Number.isInteger(rows) && rows >= data.bounds.maxRowsMin && rows <= data.bounds.maxRowsMax : false;
  const dirty =
    !!data &&
    (enabled !== data.enabled || recordIp !== data.recordIp || writeToTsLog !== data.writeToTsLog
      || days !== data.retentionDays || rows !== data.maxRows);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['change-log'] });

  const save = useMutation({
    mutationFn: () => changeLogApi.setSettings({ enabled, recordIp, writeToTsLog, retentionDays: days, maxRows: rows }),
    onSuccess: (saved) => {
      qc.setQueryData(['change-log', 'settings'], saved);
      void invalidate();
      toast.success(t('pages.changeLog.settings.saved'));
    },
    onError: () => toast.error(t('pages.changeLog.settings.saveFailed')),
  });

  const clear = useMutation({
    mutationFn: changeLogApi.clear,
    onSuccess: ({ deletedCount }) => {
      void invalidate();
      setConfirmClear(false);
      toast.success(t('pages.changeLog.settings.cleared', { count: deletedCount }));
    },
    onError: () => toast.error(t('pages.changeLog.settings.clearFailed')),
  });

  if (isLoading) return <PageLoader />;
  if (isError || !data) return <p className="text-sm text-destructive">{t('pages.changeLog.loadFailed')}</p>;

  const toggle = (id: string, label: string, hint: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label className="text-xs" htmlFor={id}>{label}</Label>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={id} />
    </div>
  );

  return (
    <div className="max-w-xl space-y-4">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.changeLog.settings.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{t('pages.changeLog.settings.description')}</p>

          {toggle('change-log-enabled', t('pages.changeLog.settings.enabledLabel'), t('pages.changeLog.settings.enabledHint'), enabled, setEnabled)}
          {toggle('change-log-record-ip', t('pages.changeLog.settings.recordIpLabel'), t('pages.changeLog.settings.recordIpHint'), recordIp, setRecordIp)}
          {toggle('change-log-ts-log', t('pages.changeLog.settings.tsLogLabel'), t('pages.changeLog.settings.tsLogHint'), writeToTsLog, setWriteToTsLog)}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="change-log-days">{t('pages.changeLog.settings.retentionLabel')}</Label>
              <Input
                id="change-log-days"
                type="number"
                min={data.bounds.retentionMin}
                max={data.bounds.retentionMax}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                aria-invalid={!daysValid}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('pages.changeLog.settings.retentionHint', { min: data.bounds.retentionMin, max: data.bounds.retentionMax })}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="change-log-rows">{t('pages.changeLog.settings.maxRowsLabel')}</Label>
              <Input
                id="change-log-rows"
                type="number"
                min={data.bounds.maxRowsMin}
                max={data.bounds.maxRowsMax}
                value={maxRows}
                onChange={(e) => setMaxRows(e.target.value)}
                aria-invalid={!rowsValid}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('pages.changeLog.settings.maxRowsHint', {
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
          <CardTitle className="text-sm font-medium">{t('pages.changeLog.settings.storedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs" data-testid="change-log-stored">
            {t('pages.changeLog.settings.stored', { count: data.entryCount })}
            {data.oldestAt && <> {t('pages.changeLog.settings.oldest', { date: new Date(data.oldestAt).toLocaleString() })}</>}
          </p>
          <Button variant="destructive" size="sm" onClick={() => setConfirmClear(true)} disabled={data.entryCount === 0}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> {t('pages.changeLog.settings.clear')}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('pages.changeLog.settings.clearTitle')}
        description={t('pages.changeLog.settings.clearDescription', { count: data.entryCount })}
        confirmLabel={t('pages.changeLog.settings.clear')}
        destructive
        loading={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </div>
  );
}
