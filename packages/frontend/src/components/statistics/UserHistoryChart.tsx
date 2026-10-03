import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts';
import type { UserHistoryResponse } from '@/api/statistics.api';
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
import {
  axisTicks,
  formatAxisTick,
  formatDateTime,
  formatTimeOnly,
  type HistoryTimeZone,
} from '@/lib/user-history-time';

const formatCount = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

interface ChartDatum {
  t: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  avg24h: number | null;
  slots: number | null;
}

interface HistoryTooltipProps {
  active?: boolean;
  label?: string | number;
  data: UserHistoryResponse;
  tz: HistoryTimeZone;
  showSlots: boolean;
}

function HistoryTooltip({ active, label, data, tz, showSlots }: HistoryTooltipProps) {
  const { t, i18n } = useTranslation();
  if (!active || typeof label !== 'number' || data.points.length === 0) return null;

  const bucketMs = data.bucketSeconds * 1000;
  const index = Math.min(
    data.points.length - 1,
    Math.max(0, Math.floor((label - data.points[0].t) / bucketMs)),
  );
  const point = data.points[index];
  const start = point.t;
  const end = point.t + bucketMs;
  const events = data.events.filter((e) => e.from < end && e.to > start);

  return (
    <div className="space-y-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">
        {formatDateTime(start, tz, i18n.language)} – {formatTimeOnly(end, tz, i18n.language)}
      </p>
      {point.avg !== null && point.max !== null && point.min !== null ? (
        <>
          <TooltipRow color={COLOR.mean} name={t('pages.serverStats.history.tooltip.mean')} value={formatCount(point.avg)} />
          <TooltipRow color="hsl(var(--chart-1) / 0.45)" name={t('pages.serverStats.history.tooltip.peak')} value={formatCount(point.max)} />
          <TooltipRow color="hsl(var(--muted-foreground))" name={t('pages.serverStats.history.tooltip.min')} value={formatCount(point.min)} />
          {point.avg24h !== null && (
            <TooltipRow color={COLOR.avg24h} name={t('pages.serverStats.history.tooltip.avg24h')} value={formatCount(point.avg24h)} />
          )}
          {showSlots && point.slots !== null && (
            <TooltipRow color={COLOR.slots} name={t('pages.serverStats.history.tooltip.slots')} value={String(point.slots)} />
          )}
        </>
      ) : (
        events.length === 0 && (
          <p className="text-muted-foreground">{t('pages.serverStats.history.tooltip.nodata')}</p>
        )
      )}
      {events.map((e, i) => (
        <p key={i} className={e.kind === 'unreachable' ? 'text-destructive' : 'text-muted-foreground'}>
          {t(`pages.serverStats.history.tooltip.${e.kind}`)}
        </p>
      ))}
    </div>
  );
}

interface UserHistoryChartProps {
  data: UserHistoryResponse;
  tz: HistoryTimeZone;
  /** Dashboard variant: shorter, and without the legend. */
  compact?: boolean;
  /** Draws the slot limit as a dashed step line and lets the axis reach up to it. */
  showSlots?: boolean;
}

export function UserHistoryChart({ data, tz, compact = false, showSlots = false }: UserHistoryChartProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const bucketMs = data.bucketSeconds * 1000;

  // Each bucket is drawn at its middle. The first and last are clamped into
  // the window, because the buckets are aligned to the epoch and so start a
  // little before `from` and end a little after `to`.
  const chartData = useMemo<ChartDatum[]>(
    () =>
      data.points.map((p) => ({
        t: Math.min(Math.max(p.t + bucketMs / 2, data.from), data.to),
        avg: p.avg,
        max: p.max,
        min: p.min,
        avg24h: p.avg24h,
        slots: p.slots,
      })),
    [data, bucketMs],
  );

  // Headroom above the highest peak, and never a flat 0-1 axis for a quiet
  // server. With the slot limit switched on the axis reaches up to the limit
  // instead, since the point of the line is to see how far the users are from it.
  const yMax = useMemo(() => {
    let top = 0;
    for (const p of data.points) {
      if (p.max !== null && p.max > top) top = p.max;
      if (showSlots && p.slots !== null && p.slots > top) top = p.slots;
    }
    return Math.max(4, Math.ceil(top * (showSlots ? 1.08 : 1.15)));
  }, [data.points, showSlots]);

  const ticks = useMemo(() => axisTicks(data.from, data.to, data.range, tz), [data.from, data.to, data.range, tz]);

  const summary = data.stats.peak
    ? t('pages.serverStats.history.chartAria', {
        range: t(`pages.serverStats.history.ranges.${data.range}`),
        peak: data.stats.peak.users,
        average: data.stats.average ?? 0,
      })
    : t('pages.serverStats.history.chartAriaEmpty');

  return (
    <div>
      <div className={compact ? 'h-[200px]' : 'h-[280px] sm:h-[340px]'} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <HatchPattern />
            </defs>

            {weekendBands(data.from, data.to, tz)}
            {eventBands(data.events, data.from, data.to, yMax)}

            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[data.from, data.to]}
              ticks={ticks}
              tickFormatter={(v: number) => formatAxisTick(v, data.range, tz, locale)}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="number"
              domain={[0, yMax]}
              allowDecimals={false}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <ReTooltip
              content={(props) => <HistoryTooltip active={props.active} label={props.label} data={data} tz={tz} showSlots={showSlots} />}
              filterNull={false}
              isAnimationActive={false}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.5 }}
            />

            <Area dataKey="max" type="monotone" stroke="none" fill={COLOR.peak} connectNulls={false} isAnimationActive={false} activeDot={false} />
            {showSlots && (
              <Line dataKey="slots" type="stepAfter" stroke={COLOR.slots} strokeWidth={1.5} strokeDasharray="10 5" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            )}
            <Line dataKey="avg24h" type="monotone" stroke={COLOR.avg24h} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="avg" type="monotone" stroke={COLOR.mean} strokeWidth={2} dot={isolatedDot(chartData, 'avg', COLOR.mean)} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {!compact && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <LegendItem swatch={<span className="inline-block h-0.5 w-4" style={{ background: COLOR.mean }} />} label={t('pages.serverStats.history.legend.mean')} />
          <LegendItem swatch={<span className={box} style={{ background: COLOR.peak }} />} label={t('pages.serverStats.history.legend.peak')} />
          <LegendItem swatch={<span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COLOR.avg24h }} />} label={t('pages.serverStats.history.legend.avg24h')} />
          {showSlots && (
            <LegendItem swatch={<span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COLOR.slots }} />} label={t('pages.serverStats.history.legend.slots')} />
          )}
          <LegendItem swatch={<span className={box} style={{ background: COLOR.saturday }} />} label={t('pages.serverStats.history.legend.saturday')} />
          <LegendItem swatch={<span className={box} style={{ background: COLOR.sunday }} />} label={t('pages.serverStats.history.legend.sunday')} />
          <LegendItem swatch={<span className={box} style={{ background: COLOR.unreachable }} />} label={t('pages.serverStats.history.legend.unreachable')} />
          <LegendItem swatch={<span className={box} style={{ backgroundImage: HATCH_CSS }} />} label={t('pages.serverStats.history.legend.stopped')} />
          <LegendItem swatch={<span className={`${box} border border-dashed border-muted-foreground`} />} label={t('pages.serverStats.history.legend.nodata')} />
        </div>
      )}
    </div>
  );
}
