import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { CONSOLE_AUDIT_RETENTION_BOUNDS, CONSOLE_SETTINGS_DEFAULTS, type ConsoleSettings } from '@ts6/common';
import { consoleApi } from '@/api/console.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

/** How long the audit trail is kept, and whether the console keeps clear of TeamSpeak's query flood limit. */
export function ConsoleSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['console-settings'], queryFn: consoleApi.getSettings });
  const [draft, setDraft] = useState<ConsoleSettings | null>(null);

  const save = useMutation({
    mutationFn: (settings: ConsoleSettings) => consoleApi.saveSettings(settings),
    onSuccess: (saved) => {
      qc.setQueryData(['console-settings'], saved);
      setDraft(null);
      toast.success(t('pages.console.settings.saved'));
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('pages.console.settings.saveFailed')),
  });

  if (isLoading || !data) return <LoadingSpinner />;

  const active = draft ?? data;
  const { min, max } = CONSOLE_AUDIT_RETENTION_BOUNDS;
  const valid = Number.isInteger(active.auditRetentionDays) && active.auditRetentionDays >= min && active.auditRetentionDays <= max;
  const matchesDefaults =
    active.auditRetentionDays === CONSOLE_SETTINGS_DEFAULTS.auditRetentionDays &&
    active.floodGuardEnabled === CONSOLE_SETTINGS_DEFAULTS.floodGuardEnabled;

  return (
    <Card className="card-hero max-w-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Settings2 className="h-4 w-4 text-primary" /> {t('pages.console.settings.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label className="text-xs" htmlFor="console-retention">
            {t('pages.console.settings.retentionLabel')}
          </Label>
          <Input
            id="console-retention"
            type="number"
            min={min}
            max={max}
            className="w-40"
            value={active.auditRetentionDays}
            onChange={(event) => setDraft({ ...active, auditRetentionDays: Number(event.target.value) })}
          />
          <p className="text-[11px] text-muted-foreground">{t('pages.console.settings.retentionHint', { min, max })}</p>
        </div>

        <div className="flex items-start gap-3">
          <Switch
            id="console-flood-guard"
            checked={active.floodGuardEnabled}
            onCheckedChange={(checked) => setDraft({ ...active, floodGuardEnabled: checked })}
          />
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="console-flood-guard">
              {t('pages.console.settings.floodGuardLabel')}
            </Label>
            <p className="text-[11px] text-muted-foreground">{t('pages.console.settings.floodGuardHint')}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => draft && save.mutate(draft)} disabled={save.isPending || !draft || !valid}>
            {t('common.save')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDraft({ ...CONSOLE_SETTINGS_DEFAULTS })} disabled={matchesDefaults}>
            {t('pages.console.settings.restoreDefaults')}
          </Button>
          {draft && <span className="text-[11px] text-muted-foreground">{t('pages.console.settings.unsaved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
