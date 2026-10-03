import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts';
import type {
  BandwidthHistoryResponse,
  MetricHistoryEvent,
  MetricHistoryResponse,
  PingHistoryResponse,
} from '@/api/statistics.api';
import {
  AXIS_TICK,
  COLOR,
  HATCH_CSS,
  HatchPattern,
  LegendItem,
  TooltipRow,
  box,
  eventBands,
  isolatedDot,
  weekendBands,
} from '@/components/statistics/history-chart-parts';
import { formatMillis, formatMillisTick, formatRate, niceScale, rateScale } from '@/lib/metric-format';
import {
  axisTicks,
  formatAxisTick,
  formatDateTime,
  formatTimeOnly,
  type HistoryTimeZone,
} from '@/lib/user-history-time';

// Download and upload keep the colours of the dashboard's bandwidth chart, and
// the ping the amber of its ping sparkline, so the same quantity reads the same
// way on both pages. The peaks are drawn as faint areas behind the lines; the
// "Swatch" variants are the same hues stronger, for the tooltip and legend,
// where a 14 % tint would hardly show.
const BANDWIDTH_COLOR = {
  down: 'hsl(var(--chart-1))',
  downPeak: 'hsl(var(--chart-1) / 0.14)',
  downPeakSwatch: 'hsl(var(--chart-1) / 0.45)',
  downAvg24h: 'hsl(var(--chart-1) / 0.75)',
  up: 'hsl(var(--chart-3))',
  upPeak: 'hsl(var(--chart-3) / 0.14)',
  upPeakSwatch: 'hsl(var(--chart-3) / 0.45)',
  upAvg24h: 'hsl(var(--chart-3) / 0.75)',
};

const PING_COLOR = {
  mean: 'hsl(var(--chart-4))',
  peak: 'hsl(var(--chart-4) / 0.18)',
  peakSwatch: 'hsl(var(--chart-4) / 0.5)',
};

interface Bucketed<P> {
  from: number;
  to: number;
  bucketSeconds: number;
  points: P[];
}

/**
 * Each bucket is drawn at its middle. The first and last are clamped into the
 * window, because the buckets are aligned to the epoch and so start a little
 * before `from` and end a little after `to`.
 */
function useChartData<P extends { t: number }>(data: Bucketed<P>): P[] {
  const bucketMs = data.bucketSeconds * 1000;
  return useMemo(
    () => data.points.map((p) => ({ ...p, t: Math.min(Math.max(p.t + bucketMs / 2, data.from), data.to) })),
    [data.points, data.from, data.to, bucketMs],
  );
}

/** The bucket under the hovered position. */
function bucketAt<P extends { t: number }>(data: Bucketed<P>, hovered: number): P {
  const bucketMs = data.bucketSeconds * 1000;
  const index = Math.min(data.points.length - 1, Math.max(0, Math.floor((hovered - data.points[0].t) / bucketMs)));
  return data.points[index];
}

const tooltipBox =
  'space-y-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md';

interface TooltipRowSpec {
  color: string;
  name: string;
  value: number | null;
  format: (value: number) => string;
}

interface MetricTooltipProps<P extends { t: number }> {
  active?: boolean;
  label?: string | number;
  data: Bucketed<P> & { events: MetricHistoryEvent[] };
  tz: HistoryTimeZone;
  rows: (point: P) => TooltipRowSpec[];
  /** A red line of its own for the bucket, when there is something to say beyond the rows (timeouts). */
  extra?: (point: P) => string | null;
}

function MetricTooltip<P extends { t: number }>({ active, label, data, tz, rows, extra }: MetricTooltipProps<P>) {
  const { t, i18n } = useTranslation();
  if (!active || typeof label !== 'number' || data.points.length === 0) return null;

  const point = bucketAt(data, label);
  const start = point.t;
  const end = start + data.bucketSeconds * 1000;
  // A ping timeout is already said, with its count, by the bucket's own red line.
  const events = data.events.filter((e) => e.from < end && e.to > start && e.kind !== 'pingtimeout');
  const shown = rows(point).filter((r): r is TooltipRowSpec & { value: number } => r.value !== null);
  const note = extra?.(point) ?? null;

  return (
    <div className={tooltipBox}>
      <p className="font-medium">
        {formatDateTime(start, tz, i18n.language)} – {formatTimeOnly(end, tz, i18n.language)}
      </p>
      {shown.map((r) => (
        <TooltipRow key={r.name} color={r.color} name={r.name} value={r.format(r.value)} />
      ))}
      {note && <p className="text-destructive">{note}</p>}
      {shown.length === 0 && !note && events.length === 0 && (
        <p className="text-muted-foreground">{t('pages.serverStats.history.tooltip.nodata')}</p>
      )}
      {events.map((e, i) => (
        <p key={i} className={e.kind === 'unreachable' ? 'text-destructive' : 'text-muted-foreground'}>
          {t(`pages.serverStats.history.tooltip.${e.kind}`)}
        </p>
      ))}
    </div>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">{children}</div>;
}

/** The marks every metric's legend ends with: the weekend bands and the outages. */
function CommonLegend({ withTimeout }: { withTimeout: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <LegendItem swatch={<span className={box} style={{ background: COLOR.saturday }} />} label={t('pages.serverStats.history.legend.saturday')} />
      <LegendItem swatch={<span className={box} style={{ background: COLOR.sunday }} />} label={t('pages.serverStats.history.legend.sunday')} />
      <LegendItem swatch={<span className={box} style={{ background: COLOR.unreachable }} />} label={t('pages.serverStats.history.legend.unreachable')} />
      <LegendItem swatch={<span className={box} style={{ backgroundImage: HATCH_CSS }} />} label={t('pages.serverStats.history.legend.stopped')} />
      {withTimeout && (
        <LegendItem
          swatch={<span className={box} style={{ background: COLOR.timeoutTint, borderTop: `3px solid ${COLOR.timeout}` }} />}
          label={t('pages.serverStats.history.ping.legend.timeout')}
        />
      )}
      <LegendItem swatch={<span className={`${box} border border-dashed border-muted-foreground`} />} label={t('pages.serverStats.history.legend.nodata')} />
    </>
  );
}

const chartHeight = 'h-[280px] sm:h-[340px]';
const chartMargin = { top: 8, right: 12, bottom: 0, left: 0 };

function BandwidthChart({ data, tz }: { data: BandwidthHistoryResponse; tz: HistoryTimeZone }) {
  const { t, i18n } = useTranslation();
  const chartData = useChartData(data);

  // The axis is in the one unit that suits the highest value, with round ticks.
  // The mean can be higher than the sampled peak (a burst between two samples),
  // so every figure counts towards the top.
  const scale = useMemo(() => {
    let top = 0;
    for (const p of data.points) top = Math.max(top, p.avgIn ?? 0, p.avgOut ?? 0, p.peakIn ?? 0, p.peakOut ?? 0);
    return rateScale(top * 1.08);
  }, [data.points]);

  const ticks = useMemo(() => axisTicks(data.from, data.to, data.range, tz), [data.from, data.to, data.range, tz]);

  const tip = (key: string) => t(`pages.serverStats.history.bandwidth.tooltip.${key}`);
  const summary = data.stats.averageIn !== null && data.stats.averageOut !== null
    ? t('pages.serverStats.history.bandwidth.chartAria', {
        range: t(`pages.serverStats.history.ranges.${data.range}`),
        down: formatRate(data.stats.averageIn),
        up: formatRate(data.stats.averageOut),
      })
    : t('pages.serverStats.history.bandwidth.chartAriaEmpty');

  const B = BANDWIDTH_COLOR;
  return (
    <div>
      <div className={chartHeight} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={chartMargin}>
            <defs>
              <HatchPattern />
            </defs>

            {weekendBands(data.from, data.to, tz)}
            {eventBands(data.events, data.from, data.to, scale.max)}

            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[data.from, data.to]}
              ticks={ticks}
              tickFormatter={(v: number) => formatAxisTick(v, data.range, tz, i18n.language)}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="number"
              domain={[0, scale.max]}
              ticks={scale.ticks}
              tickFormatter={(v: number) => scale.format(v)}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <ReTooltip
              content={(props) => (
                <MetricTooltip
                  active={props.active}
                  label={props.label}
                  data={data}
                  tz={tz}
                  rows={(p) => [
                    { color: B.down, name: tip('avgIn'), value: p.avgIn, format: formatRate },
                    { color: B.downPeakSwatch, name: tip('peakIn'), value: p.peakIn, format: formatRate },
                    { color: B.up, name: tip('avgOut'), value: p.avgOut, format: formatRate },
                    { color: B.upPeakSwatch, name: tip('peakOut'), value: p.peakOut, format: formatRate },
                    { color: B.downAvg24h, name: tip('avg24hIn'), value: p.avg24hIn, format: formatRate },
                    { color: B.upAvg24h, name: tip('avg24hOut'), value: p.avg24hOut, format: formatRate },
                  ]}
                />
              )}
              filterNull={false}
              isAnimationActive={false}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.5 }}
            />

            <Area dataKey="peakIn" type="monotone" stroke="none" fill={B.downPeak} connectNulls={false} isAnimationActive={false} activeDot={false} />
            <Area dataKey="peakOut" type="monotone" stroke="none" fill={B.upPeak} connectNulls={false} isAnimationActive={false} activeDot={false} />
            <Line dataKey="avg24hIn" type="monotone" stroke={B.downAvg24h} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="avg24hOut" type="monotone" stroke={B.upAvg24h} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="avgIn" type="monotone" stroke={B.down} strokeWidth={2} dot={isolatedDot(chartData, 'avgIn', B.down)} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="avgOut" type="monotone" stroke={B.up} strokeWidth={2} dot={isolatedDot(chartData, 'avgOut', B.up)} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Legend>
        <LegendItem swatch={<span className="inline-block h-0.5 w-4" style={{ background: B.down }} />} label={t('pages.serverStats.history.bandwidth.legend.down')} />
        <LegendItem swatch={<span className="inline-block h-0.5 w-4" style={{ background: B.up }} />} label={t('pages.serverStats.history.bandwidth.legend.up')} />
        <LegendItem
          swatch={<span className={box} style={{ background: `linear-gradient(90deg, ${B.downPeakSwatch} 50%, ${B.upPeakSwatch} 50%)` }} />}
          label={t('pages.serverStats.history.bandwidth.legend.peak')}
        />
        <LegendItem
          swatch={
            <span className="inline-flex w-4 flex-col gap-[3px]">
              <span className="border-t-2 border-dashed" style={{ borderColor: B.downAvg24h }} />
              <span className="border-t-2 border-dashed" style={{ borderColor: B.upAvg24h }} />
            </span>
          }
          label={t('pages.serverStats.history.legend.avg24h')}
        />
        <CommonLegend withTimeout={false} />
      </Legend>
    </div>
  );
}

function PingChart({ data, tz }: { data: PingHistoryResponse; tz: HistoryTimeZone }) {
  const { t, i18n } = useTranslation();
  const chartData = useChartData(data);

  const scale = useMemo(() => {
    let top = 0;
    for (const p of data.points) top = Math.max(top, p.max ?? 0, p.avg ?? 0);
    return niceScale(Math.max(top * 1.12, 10));
  }, [data.points]);

  const ticks = useMemo(() => axisTicks(data.from, data.to, data.range, tz), [data.from, data.to, data.range, tz]);

  const tip = (key: string) => t(`pages.serverStats.history.ping.tooltip.${key}`);
  const summary = data.stats.average !== null
    ? t('pages.serverStats.history.ping.chartAria', {
        range: t(`pages.serverStats.history.ranges.${data.range}`),
        average: formatMillis(data.stats.average),
        peak: data.stats.peak ? formatMillis(data.stats.peak.value) : '–',
        timeouts: data.stats.timeouts,
      })
    : t('pages.serverStats.history.ping.chartAriaEmpty');

  return (
    <div>
      <div className={chartHeight} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={chartMargin}>
            <defs>
              <HatchPattern />
            </defs>

            {weekendBands(data.from, data.to, tz)}
            {eventBands(data.events, data.from, data.to, scale.max)}

            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[data.from, data.to]}
              ticks={ticks}
              tickFormatter={(v: number) => formatAxisTick(v, data.range, tz, i18n.language)}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="number"
              domain={[0, scale.max]}
              ticks={scale.ticks}
              tickFormatter={formatMillisTick}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <ReTooltip
              content={(props) => (
                <MetricTooltip
                  active={props.active}
                  label={props.label}
                  data={data}
                  tz={tz}
                  rows={(p) => [
                    { color: PING_COLOR.mean, name: tip('mean'), value: p.avg, format: formatMillis },
                    { color: PING_COLOR.peakSwatch, name: tip('peak'), value: p.max, format: formatMillis },
                    { color: 'hsl(var(--muted-foreground))', name: tip('min'), value: p.min, format: formatMillis },
                    { color: COLOR.avg24h, name: tip('avg24h'), value: p.avg24h, format: formatMillis },
                  ]}
                  extra={(p) => (p.failed > 0 ? t('pages.serverStats.history.ping.tooltip.timeouts', { count: p.failed }) : null)}
                />
              )}
              filterNull={false}
              isAnimationActive={false}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.5 }}
            />

            <Area dataKey="max" type="monotone" stroke="none" fill={PING_COLOR.peak} connectNulls={false} isAnimationActive={false} activeDot={false} />
            <Line dataKey="avg24h" type="monotone" stroke={COLOR.avg24h} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="avg" type="monotone" stroke={PING_COLOR.mean} strokeWidth={2} dot={isolatedDot(chartData, 'avg', PING_COLOR.mean)} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Legend>
        <LegendItem swatch={<span className="inline-block h-0.5 w-4" style={{ background: PING_COLOR.mean }} />} label={t('pages.serverStats.history.ping.legend.mean')} />
        <LegendItem swatch={<span className={box} style={{ background: PING_COLOR.peak }} />} label={t('pages.serverStats.history.ping.legend.peak')} />
        <LegendItem swatch={<span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COLOR.avg24h }} />} label={t('pages.serverStats.history.legend.avg24h')} />
        <CommonLegend withTimeout />
      </Legend>
    </div>
  );
}

/** The bandwidth or ping chart of the History tab, by what the response is. */
export function MetricHistoryChart({ data, tz }: { data: MetricHistoryResponse; tz: HistoryTimeZone }) {
  return data.metric === 'bandwidth' ? <BandwidthChart data={data} tz={tz} /> : <PingChart data={data} tz={tz} />;
}
