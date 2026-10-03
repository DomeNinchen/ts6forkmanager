import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Server } from 'lucide-react';
import { HISTORY_METRICS, USER_HISTORY_RANGES, type HistoryMetric, type UserHistoryRange } from '@/api/statistics.api';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { MetricHistoryPanel } from '@/components/statistics/MetricHistoryPanel';
import { UserHistoryPanel } from '@/components/statistics/UserHistoryPanel';
import { UserHistorySettingsCard } from '@/components/statistics/UserHistorySettingsCard';
import {
  localTimeZoneName,
  readStoredTimeZone,
  storeTimeZone,
  type HistoryTimeZone,
} from '@/lib/user-history-time';
import { readStoredMetric, storeMetric } from '@/lib/user-history-prefs';

/**
 * Statistics -> History. What is drawn is picked with the first row of buttons;
 * the time range and the time zone below it apply to all of them.
 */
export function UserHistoryTab() {
  const { t } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const [metric, setMetric] = useState<HistoryMetric>(readStoredMetric);
  const [range, setRange] = useState<UserHistoryRange>('24h');
  const [tz, setTz] = useState<HistoryTimeZone>(readStoredTimeZone);

  const chooseMetric = (next: HistoryMetric) => {
    setMetric(next);
    storeMetric(next);
  };

  const chooseTimeZone = (next: HistoryTimeZone) => {
    setTz(next);
    storeTimeZone(next);
  };

  if (!selectedConfigId) return <EmptyState icon={Server} title={t('pages.serverStats.noConnectionSelected')} />;
  if (!selectedSid) {
    return <EmptyState icon={BarChart3} title={t('pages.noServerSelected')} description={t('pages.serverStats.selectServerFirst')} />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('pages.serverStats.history.metric.label')}>
          {HISTORY_METRICS.map((m) => (
            <Button key={m} size="sm" variant={metric === m ? 'default' : 'outline'} aria-pressed={metric === m} onClick={() => chooseMetric(m)}>
              {t(`pages.serverStats.history.metric.${m}`)}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('pages.serverStats.history.rangeLabel')}>
            {USER_HISTORY_RANGES.map((r) => (
              <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'} aria-pressed={range === r} onClick={() => setRange(r)}>
                {t(`pages.serverStats.history.ranges.${r}`)}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('pages.serverStats.history.timeZone.label')}</span>
            <div className="flex gap-1.5" role="group" aria-label={t('pages.serverStats.history.timeZone.label')}>
              <Button size="sm" variant={tz === 'local' ? 'default' : 'outline'} aria-pressed={tz === 'local'} onClick={() => chooseTimeZone('local')}>
                {t('pages.serverStats.history.timeZone.local', { zone: localTimeZoneName() })}
              </Button>
              <Button size="sm" variant={tz === 'utc' ? 'default' : 'outline'} aria-pressed={tz === 'utc'} onClick={() => chooseTimeZone('utc')}>
                {t('pages.serverStats.history.timeZone.utc')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {metric === 'users' ? (
        <UserHistoryPanel range={range} tz={tz} />
      ) : (
        <MetricHistoryPanel metric={metric} range={range} tz={tz} />
      )}

      <UserHistorySettingsCard />
    </div>
  );
}
