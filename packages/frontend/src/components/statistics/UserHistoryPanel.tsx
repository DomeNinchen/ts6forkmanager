import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'lucide-react';
import type { UserHistoryRange, UserHistoryResponse } from '@/api/statistics.api';
import { useUserHistory } from '@/hooks/use-user-history';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Kpi, RecordingOffNotice } from '@/components/statistics/history-chart-parts';
import { UserHistoryChart } from '@/components/statistics/UserHistoryChart';
import { formatDateTime, formatSeconds, type HistoryTimeZone } from '@/lib/user-history-time';
import { readStoredShowSlots, storeShowSlots } from '@/lib/user-history-prefs';
import { cn, timeAgo } from '@/lib/utils';

const STATE_COLOR: Record<string, string> = {
  online: 'text-emerald-400',
  stopped: 'text-amber-400',
  unreachable: 'text-destructive',
  nodata: 'text-muted-foreground',
};

/** The History tab's body while the user-count switch is on: the headline figures and the chart. */
export function UserHistoryPanel({ range, tz }: { range: UserHistoryRange; tz: HistoryTimeZone }) {
  const { t, i18n } = useTranslation();
  const [showSlots, setShowSlots] = useState<boolean>(readStoredShowSlots);
  const { data, isLoading, isError } = useUserHistory(range);

  const chooseShowSlots = (next: boolean) => {
    setShowSlots(next);
    storeShowSlots(next);
  };

  if (isLoading) return <PageLoader />;
  if (isError || !data) {
    return (
      <EmptyState
        icon={LineChart}
        title={t('pages.serverStats.history.loadFailed')}
        description={t('pages.serverStats.history.loadFailedHint')}
      />
    );
  }

  // Older rows were recorded before the slot limit was stored, so a window can
  // have no limit at all; the switch then has nothing to draw and says so.
  const hasSlots = data.points.some((p) => p.slots !== null);

  return (
    <div className="space-y-4">
      {!data.recording && <RecordingOffNotice />}

      <Kpis data={data} tz={tz} locale={i18n.language} />

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <LineChart className="h-4 w-4 text-primary" /> {t('pages.serverStats.history.chartTitle')}
            <span className="ml-auto flex items-center gap-4 text-[11px] font-normal text-muted-foreground">
              <label
                className={cn('flex items-center gap-2', hasSlots ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}
                title={hasSlots ? undefined : t('pages.serverStats.history.slots.unavailable')}
              >
                <Switch checked={showSlots && hasSlots} disabled={!hasSlots} onCheckedChange={chooseShowSlots} />
                {t('pages.serverStats.history.slots.toggle')}
              </label>
              {t('pages.serverStats.history.pointSize', { size: formatSeconds(data.bucketSeconds) })}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.firstSampleAt === null ? (
            <EmptyState
              icon={LineChart}
              className="py-10"
              title={t('pages.serverStats.history.noDataYet')}
              description={t('pages.serverStats.history.noDataYetHint', { interval: formatSeconds(data.intervalSeconds) })}
            />
          ) : (
            <>
              <UserHistoryChart data={data} tz={tz} showSlots={showSlots && hasSlots} />
              <p className="mt-3 text-[11px] text-muted-foreground">
                {t('pages.serverStats.history.recordingSince', {
                  time: formatDateTime(data.firstSampleAt, tz, i18n.language),
                  interval: formatSeconds(data.intervalSeconds),
                })}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpis({ data, tz, locale }: { data: UserHistoryResponse; tz: HistoryTimeZone; locale: string }) {
  const { t } = useTranslation();
  const { stats } = data;
  const dash = '–';
  const state = stats.currentState;

  return (
    <Card className="card-hero">
      <CardContent className="grid grid-cols-2 p-0 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label={t('pages.serverStats.history.kpi.current')}
          value={stats.current !== null ? String(stats.current) : dash}
          sub={state ? t(`pages.serverStats.history.states.${state}`) : undefined}
          subClassName={state ? STATE_COLOR[state] : undefined}
        />
        <Kpi
          label={t('pages.serverStats.history.kpi.peak')}
          value={stats.peak ? String(stats.peak.users) : dash}
          // "13 of 32 slots (41 %)" when the limit at that moment is known; the
          // time of the peak always follows, on its own line.
          sub={
            stats.peak?.slots
              ? t('pages.serverStats.history.kpi.peakOfSlots', {
                  slots: stats.peak.slots,
                  percent: Math.round((stats.peak.users / stats.peak.slots) * 100),
                })
              : stats.peak
                ? formatDateTime(stats.peak.at, tz, locale)
                : undefined
          }
          sub2={stats.peak?.slots ? formatDateTime(stats.peak.at, tz, locale) : undefined}
        />
        <Kpi
          label={t('pages.serverStats.history.kpi.average')}
          value={stats.average !== null ? stats.average.toFixed(1) : dash}
          sub={t('pages.serverStats.history.kpi.averageHint')}
        />
        <Kpi
          label={t('pages.serverStats.history.kpi.availability')}
          value={stats.availability !== null ? `${stats.availability.toFixed(1)} %` : dash}
          sub={t('pages.serverStats.history.kpi.availabilityHint')}
        />
        <Kpi
          label={t('pages.serverStats.history.kpi.lastSample')}
          value={stats.lastSampleAt !== null ? timeAgo(Math.floor(stats.lastSampleAt / 1000)) : dash}
          sub={stats.lastSampleAt !== null ? formatDateTime(stats.lastSampleAt, tz, locale) : undefined}
        />
      </CardContent>
    </Card>
  );
}
