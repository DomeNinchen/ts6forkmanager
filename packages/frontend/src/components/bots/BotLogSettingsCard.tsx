import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Database } from 'lucide-react';
import { settingsApi, type BotLogSettings } from '@/api/settings.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

/**
 * How long bot-flow executions and their logs are kept, and the per-table row
 * cap. Admin-only and instance-wide (every server's flows share it); shown on
 * the Bot Flows page so it sits next to the flows whose history it bounds.
 */
export function BotLogSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['bot-log-settings'],
    queryFn: settingsApi.getBotLogSettings,
  });

  const [draft, setDraft] = useState<BotLogSettings | null>(null);

  const save = useMutation({
    mutationFn: (config: BotLogSettings) => settingsApi.setBotLogSettings(config),
    onSuccess: (saved) => {
      qc.setQueryData(['bot-log-settings'], saved);
      setDraft(null);
      toast.success(t('pages.botList.retention.saved'));
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('pages.botList.retention.saveFailed')),
  });

  if (isLoading || !data) return <LoadingSpinner />;

  const active: BotLogSettings = draft ?? {
    retentionDays: data.retentionDays, maxRows: data.maxRows, maxConcurrentPerFlow: data.maxConcurrentPerFlow,
  };
  const { retentionMin, retentionMax, maxRowsMin, maxRowsMax, maxConcurrentMin, maxConcurrentMax } = data.bounds;
  const valid =
    Number.isInteger(active.retentionDays) && active.retentionDays >= retentionMin && active.retentionDays <= retentionMax &&
    Number.isInteger(active.maxRows) && active.maxRows >= maxRowsMin && active.maxRows <= maxRowsMax &&
    Number.isInteger(active.maxConcurrentPerFlow) &&
    active.maxConcurrentPerFlow >= maxConcurrentMin && active.maxConcurrentPerFlow <= maxConcurrentMax;
  const matchesDefaults =
    active.retentionDays === data.defaults.retentionDays && active.maxRows === data.defaults.maxRows &&
    active.maxConcurrentPerFlow === data.defaults.maxConcurrentPerFlow;

  return (
    <Card className="card-hero">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Database className="h-4 w-4 text-primary" /> {t('pages.botList.retention.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('pages.botList.retention.description')}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-xs" htmlFor="bot-log-retention">{t('pages.botList.retention.retentionLabel')}</Label>
            <Input
              id="bot-log-retention"
              type="number"
              min={retentionMin}
              max={retentionMax}
              value={active.retentionDays}
              onChange={(e) => setDraft({ ...active, retentionDays: Number(e.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('pages.botList.retention.retentionHint', { min: retentionMin, max: retentionMax })}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs" htmlFor="bot-log-max-rows">{t('pages.botList.retention.maxRowsLabel')}</Label>
            <Input
              id="bot-log-max-rows"
              type="number"
              min={maxRowsMin}
              max={maxRowsMax}
              value={active.maxRows}
              onChange={(e) => setDraft({ ...active, maxRows: Number(e.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('pages.botList.retention.maxRowsHint', { min: maxRowsMin, max: maxRowsMax })}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs" htmlFor="bot-flow-max-concurrent">{t('pages.botList.retention.maxConcurrentLabel')}</Label>
            <Input
              id="bot-flow-max-concurrent"
              type="number"
              min={maxConcurrentMin}
              max={maxConcurrentMax}
              value={active.maxConcurrentPerFlow}
              onChange={(e) => setDraft({ ...active, maxConcurrentPerFlow: Number(e.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('pages.botList.retention.maxConcurrentHint', { min: maxConcurrentMin, max: maxConcurrentMax })}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          {t('pages.botList.retention.stats', { executions: data.executionCount, logs: data.logCount })}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => save.mutate(active)} disabled={save.isPending || !draft || !valid}>
            {t('common.save')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDraft({ ...data.defaults })} disabled={matchesDefaults}>
            {t('pages.botList.retention.restoreDefaults')}
          </Button>
          {draft && <span className="text-[11px] text-muted-foreground">{t('pages.botList.retention.unsaved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
