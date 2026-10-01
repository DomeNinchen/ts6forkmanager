import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts';
import type { UserHistoryEvent, UserHistoryResponse } from '@/api/statistics.api';
import {
  axisTicks,
  formatAxisTick,
  formatDateTime,
  formatTimeOnly,
  weekendAreas,
  type HistoryTimeZone,
} from '@/lib/user-history-time';

// Colours come from the theme tokens so the chart follows every base theme and
// accent, light and dark. The 24-hour line uses the foreground colour on
// purpose: an accent-coloured second line would collide with the user line
// under some accents, a neutral dashed one never does.
const COLOR = {
  mean: 'hsl(var(--chart-1))',
  peak: 'hsl(var(--chart-1) / 0.16)',
  avg24h: 'hsl(var(--foreground) / 0.75)',
  saturday: 'hsl(var(--muted-foreground) / 0.14)',
  sunday: 'hsl(var(--destructive) / 0.12)',
  unreachableTint: 'hsl(var(--destructive) / 0.16)',
  unreachable: 'hsl(var(--destructive))',
  stoppedTint: 'hsl(var(--muted-foreground) / 0.14)',
};

/** Hatched fill for "virtual server stopped": grey diagonal stripes, distinct from the plain Saturday tint. */
const HATCH_ID = 'user-history-hatch';
const HATCH_CSS =
  'repeating-linear-gradient(45deg, hsl(var(--muted-foreground)) 0 2px, transparent 2px 5px)';

const formatCount = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

interface ChartDatum {
  t: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  avg24h: number | null;
}

interface HistoryTooltipProps {
  active?: boolean;
  label?: string | number;
  data: UserHistoryResponse;
  tz: HistoryTimeZone;
}

function TooltipRow({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        {name}
      </span>
      <span className="font-mono-data">{value}</span>
    </div>
  );
}

function HistoryTooltip({ active, label, data, tz }: HistoryTooltipProps) {
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

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {swatch}
      {label}
    </span>
  );
}

const box = 'inline-block h-3 w-3 rounded-[2px]';

export function UserHistoryChart({ data, tz }: { data: UserHistoryResponse; tz: HistoryTimeZone }) {
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
      })),
    [data, bucketMs],
  );

  // Headroom above the highest peak, and never a flat 0-1 axis for a quiet server.
  const yMax = useMemo(() => {
    let top = 0;
    for (const p of data.points) if (p.max !== null && p.max > top) top = p.max;
    return Math.max(4, Math.ceil(top * 1.15));
  }, [data.points]);

  const ticks = useMemo(() => axisTicks(data.from, data.to, data.range, tz), [data.from, data.to, data.range, tz]);
  const weekends = useMemo(() => weekendAreas(data.from, data.to, tz), [data.from, data.to, tz]);

  // An outage of a minute is under a pixel wide on a month view; widen the
  // marker to something you can see without changing where it is centred.
  const minWidth = (data.to - data.from) * 0.004;
  const marker = (e: UserHistoryEvent) => {
    const width = e.to - e.from;
    if (width >= minWidth) return { from: e.from, to: e.to };
    const mid = (e.from + e.to) / 2;
    return { from: Math.max(data.from, mid - minWidth / 2), to: Math.min(data.to, mid + minWidth / 2) };
  };
  const markedEvents = data.events.filter((e) => e.kind !== 'nodata');
  const stripHeight = yMax * 0.07;

  // A bucket with a number on both sides is part of the line; one with empty
  // buckets on both sides has no line to belong to and would vanish entirely.
  const isolatedDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    const i = index ?? -1;
    const alone = chartData[i]?.avg != null && chartData[i - 1]?.avg == null && chartData[i + 1]?.avg == null;
    if (cx == null || cy == null || !alone) return <g key={`dot-${i}`} />;
    return <circle key={`dot-${i}`} cx={cx} cy={cy} r={2.5} fill={COLOR.mean} />;
  };

  const summary = data.stats.peak
    ? t('pages.serverStats.history.chartAria', {
        range: t(`pages.serverStats.history.ranges.${data.range}`),
        peak: data.stats.peak.users,
        average: data.stats.average ?? 0,
      })
    : t('pages.serverStats.history.chartAriaEmpty');

  return (
    <div>
      <div className="h-[280px] sm:h-[340px]" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <pattern id={HATCH_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'hsl(var(--muted-foreground))' }} strokeWidth="2" />
              </pattern>
            </defs>

            {weekends.map((w) => (
              <ReferenceArea
                key={`weekend-${w.kind}-${w.from}`}
                x1={w.from}
                x2={w.to}
                fill={w.kind === 'sunday' ? COLOR.sunday : COLOR.saturday}
                stroke="none"
                ifOverflow="hidden"
                zIndex={50}
              />
            ))}

            {markedEvents.flatMap((e) => {
              const { from, to } = marker(e);
              const unreachable = e.kind === 'unreachable';
              return [
                <ReferenceArea
                  key={`tint-${e.kind}-${e.from}`}
                  x1={from}
                  x2={to}
                  fill={unreachable ? COLOR.unreachableTint : COLOR.stoppedTint}
                  stroke="none"
                  ifOverflow="hidden"
                  zIndex={60}
                />,
                <ReferenceArea
                  key={`strip-${e.kind}-${e.from}`}
                  x1={from}
                  x2={to}
                  y1={0}
                  y2={stripHeight}
                  fill={unreachable ? COLOR.unreachable : `url(#${HATCH_ID})`}
                  stroke="none"
                  ifOverflow="hidden"
                  zIndex={150}
                />,
              ];
            })}

            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[data.from, data.to]}
              ticks={ticks}
              tickFormatter={(v: number) => formatAxisTick(v, data.range, tz, locale)}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="number"
              domain={[0, yMax]}
              allowDecimals={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <ReTooltip
              content={(props) => <HistoryTooltip active={props.active} label={props.label} data={data} tz={tz} />}
              filterNull={false}
              isAnimationActive={false}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.5 }}
            />

            <Area dataKey="max" type="monotone" stroke="none" fill={COLOR.peak} connectNulls={false} isAnimationActive={false} activeDot={false} />
            <Line dataKey="avg24h" type="monotone" stroke={COLOR.avg24h} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="avg" type="monotone" stroke={COLOR.mean} strokeWidth={2} dot={isolatedDot} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <LegendItem swatch={<span className="inline-block h-0.5 w-4" style={{ background: COLOR.mean }} />} label={t('pages.serverStats.history.legend.mean')} />
        <LegendItem swatch={<span className={box} style={{ background: COLOR.peak }} />} label={t('pages.serverStats.history.legend.peak')} />
        <LegendItem swatch={<span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COLOR.avg24h }} />} label={t('pages.serverStats.history.legend.avg24h')} />
        <LegendItem swatch={<span className={box} style={{ background: COLOR.saturday }} />} label={t('pages.serverStats.history.legend.saturday')} />
        <LegendItem swatch={<span className={box} style={{ background: COLOR.sunday }} />} label={t('pages.serverStats.history.legend.sunday')} />
        <LegendItem swatch={<span className={box} style={{ background: COLOR.unreachable }} />} label={t('pages.serverStats.history.legend.unreachable')} />
        <LegendItem swatch={<span className={box} style={{ backgroundImage: HATCH_CSS }} />} label={t('pages.serverStats.history.legend.stopped')} />
        <LegendItem swatch={<span className={`${box} border border-dashed border-muted-foreground`} />} label={t('pages.serverStats.history.legend.nodata')} />
      </div>
    </div>
  );
}
