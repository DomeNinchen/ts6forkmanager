import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BarChart3, LineChart, Server } from 'lucide-react';
import { USER_HISTORY_RANGES, type UserHistoryRange, type UserHistoryResponse } from '@/api/statistics.api';
import { useUserHistory } from '@/hooks/use-user-history';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { UserHistoryChart } from '@/components/statistics/UserHistoryChart';
import { UserHistorySettingsCard } from '@/components/statistics/UserHistorySettingsCard';
import {
  formatDateTime,
  formatSeconds,
  localTimeZoneName,
  readStoredTimeZone,
  storeTimeZone,
  type HistoryTimeZone,
} from '@/lib/user-history-time';
import { readStoredShowSlots, storeShowSlots } from '@/lib/user-history-prefs';
import { cn, timeAgo } from '@/lib/utils';

const STATE_COLOR: Record<string, string> = {
  online: 'text-emerald-400',
  stopped: 'text-amber-400',
  unreachable: 'text-destructive',
  nodata: 'text-muted-foreground',
};

function Kpi({ label, value, sub, sub2, subClassName }: { label: string; value: string; sub?: string; sub2?: string; subClassName?: string }) {
  return (
    <div className="min-w-0 p-4">
      <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-mono-data text-lg font-bold leading-tight">{value}</p>
      {sub && <p className={cn('truncate text-[11px] text-muted-foreground', subClassName)}>{sub}</p>}
      {sub2 && <p className="truncate text-[11px] text-muted-foreground">{sub2}</p>}
    </div>
  );
}

export function UserHistoryTab() {
  const { t, i18n } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const [range, setRange] = useState<UserHistoryRange>('24h');
  const [tz, setTz] = useState<HistoryTimeZone>(readStoredTimeZone);
  const [showSlots, setShowSlots] = useState<boolean>(readStoredShowSlots);
  const { data, isLoading, isError } = useUserHistory(range);

  const chooseTimeZone = (next: HistoryTimeZone) => {
    setTz(next);
    storeTimeZone(next);
  };

  const chooseShowSlots = (next: boolean) => {
    setShowSlots(next);
    storeShowSlots(next);
  };

  if (!selectedConfigId) return <EmptyState icon={Server} title={t('pages.serverStats.noConnectionSelected')} />;
  if (!selectedSid) {
    return <EmptyState icon={BarChart3} title={t('pages.noServerSelected')} description={t('pages.serverStats.selectServerFirst')} />;
  }
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

      {!data.recording && (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium">{t('pages.serverStats.history.recordingOff')}</p>
            <p className="text-muted-foreground">{t('pages.serverStats.history.recordingOffHint')}</p>
          </div>
        </div>
      )}

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

      <UserHistorySettingsCard />
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
