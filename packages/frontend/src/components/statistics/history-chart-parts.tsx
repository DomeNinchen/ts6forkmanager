import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { ReferenceArea } from 'recharts';
import { weekendAreas, type HistoryTimeZone } from '@/lib/user-history-time';
import { cn } from '@/lib/utils';

// What the History charts - the user count, bandwidth and ping - have in
// common: the colours, the stripes for "virtual server stopped", the weekend
// and outage bands, and the small building blocks around the plot.

// Colours come from the theme tokens so the charts follow every base theme and
// accent, light and dark. The 24-hour line of the single-line charts uses the
// foreground colour on purpose: an accent-coloured second line would collide
// with the main line under some accents, a neutral dashed one never does.
export const COLOR = {
  mean: 'hsl(var(--chart-1))',
  peak: 'hsl(var(--chart-1) / 0.16)',
  avg24h: 'hsl(var(--foreground) / 0.75)',
  saturday: 'hsl(var(--muted-foreground) / 0.14)',
  sunday: 'hsl(var(--destructive) / 0.12)',
  unreachableTint: 'hsl(var(--destructive) / 0.16)',
  unreachable: 'hsl(var(--destructive))',
  stoppedTint: 'hsl(var(--muted-foreground) / 0.14)',
  // The ping target did not answer: red like the other failures, but drawn
  // along the top edge, where "server unreachable" has no mark, so the two
  // never look alike.
  timeoutTint: 'hsl(var(--destructive) / 0.12)',
  timeout: 'hsl(var(--destructive))',
  // Long dashes in the muted colour: unlike the short-dashed 24-hour line it
  // reads as a ceiling rather than as another measurement.
  slots: 'hsl(var(--muted-foreground))',
};

/** Hatched fill for "virtual server stopped": grey diagonal stripes, distinct from the plain Saturday tint. */
export const HATCH_ID = 'user-history-hatch';
export const HATCH_CSS = 'repeating-linear-gradient(45deg, hsl(var(--muted-foreground)) 0 2px, transparent 2px 5px)';

export const AXIS_TICK = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' };

/** The stripe pattern the stopped marks refer to; goes inside the chart's <defs>. */
export function HatchPattern() {
  return (
    <pattern id={HATCH_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'hsl(var(--muted-foreground))' }} strokeWidth="2" />
    </pattern>
  );
}

/** The Saturdays and Sundays of the window as faint bands behind the plot. */
export function weekendBands(from: number, to: number, tz: HistoryTimeZone): ReactElement[] {
  return weekendAreas(from, to, tz).map((w) => (
    <ReferenceArea
      key={`weekend-${w.kind}-${w.from}`}
      x1={w.from}
      x2={w.to}
      fill={w.kind === 'sunday' ? COLOR.sunday : COLOR.saturday}
      stroke="none"
      ifOverflow="hidden"
      zIndex={50}
    />
  ));
}

interface EventLike {
  kind: string;
  from: number;
  to: number;
}

/**
 * The stretches the server was unreachable or stopped - and, on the ping chart,
 * the ones where the ping target did not answer: a tint over the whole height
 * plus a solid strip along the bottom (top for the ping timeouts). "No
 * measurement" is not drawn; it is simply the gap in the line.
 *
 * An outage of a minute is under a pixel wide on a month view, so a marker is
 * widened to something you can see without changing where it is centred.
 */
export function eventBands(events: EventLike[], from: number, to: number, yMax: number): ReactElement[] {
  const minWidth = (to - from) * 0.004;
  const stripHeight = yMax * 0.07;

  return events.flatMap((e) => {
    if (e.kind === 'nodata') return [];

    let start = e.from;
    let end = e.to;
    if (end - start < minWidth) {
      const mid = (e.from + e.to) / 2;
      start = Math.max(from, mid - minWidth / 2);
      end = Math.min(to, mid + minWidth / 2);
    }

    const unreachable = e.kind === 'unreachable';
    const timeout = e.kind === 'pingtimeout';
    return [
      <ReferenceArea
        key={`tint-${e.kind}-${e.from}`}
        x1={start}
        x2={end}
        fill={unreachable ? COLOR.unreachableTint : timeout ? COLOR.timeoutTint : COLOR.stoppedTint}
        stroke="none"
        ifOverflow="hidden"
        zIndex={60}
      />,
      <ReferenceArea
        key={`strip-${e.kind}-${e.from}`}
        x1={start}
        x2={end}
        y1={timeout ? yMax - stripHeight : 0}
        y2={timeout ? yMax : stripHeight}
        fill={unreachable ? COLOR.unreachable : timeout ? COLOR.timeout : `url(#${HATCH_ID})`}
        stroke="none"
        ifOverflow="hidden"
        zIndex={150}
      />,
    ];
  });
}

/**
 * A bucket with a number on both sides is part of the line; one with empty
 * buckets on both sides has no line to belong to and would vanish entirely, so
 * it gets a dot of its own.
 */
export function isolatedDot<Row extends object>(rows: Row[], key: keyof Row, color: string) {
  return (props: { cx?: number; cy?: number; index?: number }): ReactElement => {
    const { cx, cy, index } = props;
    const i = index ?? -1;
    const alone = rows[i]?.[key] != null && rows[i - 1]?.[key] == null && rows[i + 1]?.[key] == null;
    if (cx == null || cy == null || !alone) return <g key={`dot-${i}`} />;
    return <circle key={`dot-${i}`} cx={cx} cy={cy} r={2.5} fill={color} />;
  };
}

export function TooltipRow({ color, name, value }: { color: string; name: string; value: string }) {
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

export function LegendItem({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {swatch}
      {label}
    </span>
  );
}

/** A small square colour swatch for the legend. */
export const box = 'inline-block h-3 w-3 rounded-[2px]';

export function Kpi({
  label,
  value,
  sub,
  sub2,
  subClassName,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  sub2?: ReactNode;
  subClassName?: string;
}) {
  return (
    <div className="min-w-0 p-4">
      <p className="truncate font-display text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-mono-data text-lg font-bold leading-tight">{value}</p>
      {sub && <p className={cn('truncate text-[11px] text-muted-foreground', subClassName)}>{sub}</p>}
      {sub2 && <p className="truncate text-[11px] text-muted-foreground">{sub2}</p>}
    </div>
  );
}

/** The amber notice above a chart whose connection has recording switched off. */
export function RecordingOffNotice() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div>
        <p className="font-medium">{t('pages.serverStats.history.recordingOff')}</p>
        <p className="text-muted-foreground">{t('pages.serverStats.history.recordingOffHint')}</p>
      </div>
    </div>
  );
}
