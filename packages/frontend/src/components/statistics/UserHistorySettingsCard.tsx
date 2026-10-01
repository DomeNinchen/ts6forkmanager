import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Database } from 'lucide-react';
import { settingsApi, type UserHistorySettings } from '@/api/settings.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { formatBytes } from '@/lib/utils';
import { formatSeconds } from '@/lib/user-history-time';

/**
 * Measured, not guessed: a row of the history table takes about 90 bytes
 * including its index entry. Only used for the size estimate under the form.
 */
const BYTES_PER_ROW = 90;

/**
 * How often the user count is measured and how long it is kept. Admin-only
 * because the whole Statistics page is; lives here rather than in Settings so
 * the values sit next to the chart they shape.
 */
export function UserHistorySettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['user-history-settings'],
    queryFn: settingsApi.getUserHistorySettings,
  });

  const [draft, setDraft] = useState<UserHistorySettings | null>(null);
  const [confirmShorter, setConfirmShorter] = useState(false);

  const save = useMutation({
    mutationFn: (config: UserHistorySettings) => settingsApi.setUserHistorySettings(config),
    onSuccess: (saved) => {
      qc.setQueryData(['user-history-settings'], saved);
      // The chart reports the interval and retention it was drawn with.
      qc.invalidateQueries({ queryKey: ['user-history'] });
      setDraft(null);
      setConfirmShorter(false);
      toast.success(t('pages.serverStats.history.settings.saved'));
    },
    onError: (err: any) => {
      setConfirmShorter(false);
      toast.error(err?.response?.data?.error || t('pages.serverStats.history.settings.saveFailed'));
    },
  });

  if (isLoading || !data) return <LoadingSpinner />;

  const active: UserHistorySettings = draft ?? { intervalSeconds: data.intervalSeconds, retentionDays: data.retentionDays };
  const { min, max } = data.retentionBounds;
  const valid =
    data.intervalOptions.includes(active.intervalSeconds) &&
    Number.isInteger(active.retentionDays) &&
    active.retentionDays >= min &&
    active.retentionDays <= max;
  const shortens = active.retentionDays < data.retentionDays;
  const matchesDefaults =
    active.intervalSeconds === data.defaults.intervalSeconds && active.retentionDays === data.defaults.retentionDays;

  // One virtual server's worth at the values in the form.
  const estimatedBytes = valid ? ((active.retentionDays * 86_400) / active.intervalSeconds) * BYTES_PER_ROW : null;

  const submit = () => (shortens ? setConfirmShorter(true) : save.mutate(active));

  return (
    <Card className="card-hero">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Database className="h-4 w-4 text-primary" /> {t('pages.serverStats.history.settings.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('pages.serverStats.history.settings.description')}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs" htmlFor="user-history-interval">{t('pages.serverStats.history.settings.intervalLabel')}</Label>
            <Select
              value={String(active.intervalSeconds)}
              onValueChange={(v) => setDraft({ ...active, intervalSeconds: Number(v) })}
            >
              <SelectTrigger id="user-history-interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.intervalOptions.map((seconds) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {t(`pages.serverStats.history.settings.intervalOptions.${seconds}`, { defaultValue: formatSeconds(seconds) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs" htmlFor="user-history-retention">{t('pages.serverStats.history.settings.retentionLabel')}</Label>
            <Input
              id="user-history-retention"
              type="number"
              min={min}
              max={max}
              value={active.retentionDays}
              onChange={(e) => setDraft({ ...active, retentionDays: Number(e.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('pages.serverStats.history.settings.retentionHint', { min, max })}
            </p>
          </div>
        </div>

        {estimatedBytes !== null && (
          <p className="text-[11px] text-muted-foreground">
            {t('pages.serverStats.history.settings.estimate', { size: formatBytes(estimatedBytes) })}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={submit} disabled={save.isPending || !draft || !valid}>
            {t('common.save')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft({ ...data.defaults })}
            disabled={matchesDefaults}
          >
            {t('pages.serverStats.history.settings.restoreDefaults')}
          </Button>
          {draft && <span className="text-[11px] text-muted-foreground">{t('pages.serverStats.history.settings.unsaved')}</span>}
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmShorter}
        onOpenChange={setConfirmShorter}
        title={t('pages.serverStats.history.settings.confirmShorterTitle')}
        description={t('pages.serverStats.history.settings.confirmShorterDescription', { days: active.retentionDays })}
        confirmLabel={t('pages.serverStats.history.settings.confirmShorterAction')}
        destructive
        loading={save.isPending}
        onConfirm={() => save.mutate(active)}
      />
    </Card>
  );
}
