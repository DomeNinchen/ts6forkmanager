import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Webhook } from 'lucide-react';
import { settingsApi, type WebhookSettings } from '@/api/settings.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

const FIELDS: Array<keyof WebhookSettings> = ['bodyLimitKb', 'validPerMinute', 'failedPerMinute'];

/** Limits on incoming webhook calls (body size, calls per address and minute). Admin-only, instance-wide. */
export function WebhookSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['webhook-settings'], queryFn: settingsApi.getWebhookSettings });
  const [draft, setDraft] = useState<WebhookSettings | null>(null);

  const save = useMutation({
    mutationFn: (values: WebhookSettings) => settingsApi.setWebhookSettings(values),
    onSuccess: (saved) => {
      qc.setQueryData(['webhook-settings'], saved);
      setDraft(null);
      toast.success(t('pages.botList.webhooks.saved'));
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('pages.botList.webhooks.saveFailed')),
  });

  if (isLoading || !data) return <LoadingSpinner />;

  const active: WebhookSettings = draft ?? {
    bodyLimitKb: data.bodyLimitKb, validPerMinute: data.validPerMinute, failedPerMinute: data.failedPerMinute,
  };
  const valid = FIELDS.every((f) => Number.isInteger(active[f]) && active[f] >= data.bounds[f].min && active[f] <= data.bounds[f].max);
  const matchesDefaults = FIELDS.every((f) => active[f] === data.defaults[f]);

  return (
    <Card className="card-hero">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Webhook className="h-4 w-4 text-primary" /> {t('pages.botList.webhooks.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t('pages.botList.webhooks.description')}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <div key={f} className="space-y-2">
              <Label className="text-xs" htmlFor={`webhook-${f}`}>{t(`pages.botList.webhooks.${f}Label`)}</Label>
              <Input
                id={`webhook-${f}`}
                type="number"
                min={data.bounds[f].min}
                max={data.bounds[f].max}
                value={active[f]}
                onChange={(e) => setDraft({ ...active, [f]: Number(e.target.value) })}
              />
              <p className="text-[11px] text-muted-foreground">
                {t(`pages.botList.webhooks.${f}Hint`, { min: data.bounds[f].min, max: data.bounds[f].max })}
              </p>
            </div>
          ))}
        </div>

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
