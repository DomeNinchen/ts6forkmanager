import { useTranslation } from 'react-i18next';
import { Activity, ArrowDownToLine, ArrowUpFromLine, LineChart, Timer, type LucideIcon } from 'lucide-react';
import type {
  BandwidthHistoryResponse,
  MetricKind,
  MetricPeak,
  PingHistoryResponse,
  UserHistoryRange,
} from '@/api/statistics.api';
import { useMetricHistory } from '@/hooks/use-user-history';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Kpi, RecordingOffNotice } from '@/components/statistics/history-chart-parts';
import { MetricHistoryChart } from '@/components/statistics/MetricHistoryChart';
import { formatMillis, formatRate } from '@/lib/metric-format';
import { formatDateTime, formatSeconds, type HistoryTimeZone } from '@/lib/user-history-time';
import { formatBytes, timeAgo } from '@/lib/utils';

const DASH = '–';

// The download and upload arrows wear the colours of the two lines in the chart.
const DOWN_COLOR = 'hsl(var(--chart-1))';
const UP_COLOR = 'hsl(var(--chart-3))';

function Direction({ down, value, sub }: { down: boolean; value: string; sub?: string }) {
  const { t } = useTranslation();
  const Icon = down ? ArrowDownToLine : ArrowUpFromLine;
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 font-mono-data text-sm font-bold leading-tight">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: down ? DOWN_COLOR : UP_COLOR }} aria-hidden="true" />
        <span className="sr-only">{t(`pages.serverStats.history.bandwidth.legend.${down ? 'down' : 'up'}`)}</span>
        <span className="truncate">{value}</span>
      </p>
      {sub && <p className="truncate pl-5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** A figure that exists for both directions: download on one line, upload under it. */
function PairKpi({
  label,
  down,
  up,
  downSub,
  upSub,
  sub,
}: {
  label: string;
  down: string;
  up: string;
  downSub?: string;
  upSub?: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 space-y-1 p-4">
      <p className="truncate font-display text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <Direction down value={down} sub={downSub} />
      <Direction down={false} value={up} sub={upSub} />
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function BandwidthKpis({ data, tz, locale }: { data: BandwidthHistoryResponse; tz: HistoryTimeZone; locale: string }) {
  const { t } = useTranslation();
  const { stats } = data;
  const rate = (value: number | null) => (value !== null ? formatRate(value) : DASH);
  const peakTime = (peak: MetricPeak | null) => (peak ? formatDateTime(peak.at, tz, locale) : undefined);
  // The newest window is too old to mean "now" (nothing was measured for a while).
  const stale = stats.lastSampleAt !== null && stats.currentIn === null;

  return (
    <Card className="card-hero">
      <CardContent className="grid grid-cols-2 p-0 sm:grid-cols-3 lg:grid-cols-5">
        <PairKpi
          label={t('pages.serverStats.history.bandwidth.kpi.current')}
          down={rate(stats.currentIn)}
          up={rate(stats.currentOut)}
          sub={stale ? t('pages.serverStats.history.states.nodata') : undefined}
        />
        <PairKpi
          label={t('pages.serverStats.history.bandwidth.kpi.peak')}
          down={rate(stats.peakIn?.value ?? null)}
          up={rate(stats.peakOut?.value ?? null)}
          downSub={peakTime(stats.peakIn)}
          upSub={peakTime(stats.peakOut)}
        />
        <PairKpi
          label={t('pages.serverStats.history.bandwidth.kpi.average')}
          down={rate(stats.averageIn)}
          up={rate(stats.averageOut)}
          sub={t('pages.serverStats.history.kpi.averageHint')}
        />
        <PairKpi
          label={t('pages.serverStats.history.bandwidth.kpi.volume')}
          down={stats.averageIn !== null ? formatBytes(stats.totalIn) : DASH}
          up={stats.averageOut !== null ? formatBytes(stats.totalOut) : DASH}
          sub={t('pages.serverStats.history.kpi.averageHint')}
        />
        <Kpi
          label={t('pages.serverStats.history.kpi.lastSample')}
          value={stats.lastSampleAt !== null ? timeAgo(Math.floor(stats.lastSampleAt / 1000)) : DASH}
          sub={stats.lastSampleAt !== null ? formatDateTime(stats.lastSampleAt, tz, locale) : undefined}
        />
      </CardContent>
    </Card>
  );
}

function PingKpis({ data, tz, locale }: { data: PingHistoryResponse; tz: HistoryTimeZone; locale: string }) {
  const { t } = useTranslation();
  const { stats } = data;
  const stale = stats.lastSampleAt !== null && stats.current === null;

  return (
    <Card className="card-hero">
      <CardContent className="grid grid-cols-2 p-0 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label={t('pages.serverStats.history.ping.kpi.current')}
          value={stats.current !== null ? formatMillis(stats.current) : DASH}
          sub={stale ? t('pages.serverStats.history.states.nodata') : undefined}
        />
        <Kpi
          label={t('pages.serverStats.history.ping.kpi.peak')}
          value={stats.peak ? formatMillis(stats.peak.value) : DASH}
          sub={stats.peak ? formatDateTime(stats.peak.at, tz, locale) : undefined}
        />
        <Kpi
          label={t('pages.serverStats.history.ping.kpi.average')}
          value={stats.average !== null ? formatMillis(stats.average) : DASH}
          sub={t('pages.serverStats.history.kpi.averageHint')}
        />
        <Kpi
          label={t('pages.serverStats.history.ping.kpi.timeouts')}
          value={stats.timeoutShare !== null ? `${parseFloat(stats.timeoutShare.toFixed(1))} %` : DASH}
          sub={t('pages.serverStats.history.ping.kpi.timeoutsCount', { count: stats.timeouts })}
          subClassName={stats.timeouts > 0 ? 'text-destructive' : undefined}
        />
        <Kpi
          label={t('pages.serverStats.history.kpi.lastSample')}
          value={stats.lastSampleAt !== null ? timeAgo(Math.floor(stats.lastSampleAt / 1000)) : DASH}
          sub={stats.lastSampleAt !== null ? formatDateTime(stats.lastSampleAt, tz, locale) : undefined}
        />
      </CardContent>
    </Card>
  );
}

const METRIC_ICON: Record<MetricKind, LucideIcon> = { bandwidth: Activity, ping: Timer };

/** The History tab's body while the bandwidth or ping switch is on: the headline figures and the chart. */
export function MetricHistoryPanel({ metric, range, tz }: { metric: MetricKind; range: UserHistoryRange; tz: HistoryTimeZone }) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useMetricHistory(metric, range);
  const Icon = METRIC_ICON[metric];

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

  const target = `${data.pingTarget.host}:${data.pingTarget.port}`;
  const title =
    data.metric === 'ping'
      ? t('pages.serverStats.history.ping.chartTitle', { target })
      : t('pages.serverStats.history.bandwidth.chartTitle');

  return (
    <div className="space-y-4">
      {!data.recording && <RecordingOffNotice />}

      {data.metric === 'bandwidth' ? (
        <BandwidthKpis data={data} tz={tz} locale={i18n.language} />
      ) : (
        <PingKpis data={data} tz={tz} locale={i18n.language} />
      )}

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Icon className="h-4 w-4 text-primary" /> {title}
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              {t('pages.serverStats.history.pointSize', { size: formatSeconds(data.bucketSeconds) })}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.firstSampleAt === null ? (
            <EmptyState
              icon={Icon}
              className="py-10"
              title={t('pages.serverStats.history.noDataYet')}
              description={t('pages.serverStats.history.metricNoDataYetHint', { interval: formatSeconds(data.intervalSeconds) })}
            />
          ) : (
            <>
              <MetricHistoryChart data={data} tz={tz} />
              <p className="mt-3 text-[11px] text-muted-foreground">
                {t('pages.serverStats.history.metricRecordingSince', {
                  time: formatDateTime(data.firstSampleAt, tz, i18n.language),
                  interval: formatSeconds(data.intervalSeconds),
                })}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t(`pages.serverStats.history.${data.metric}.note`, { target })}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
