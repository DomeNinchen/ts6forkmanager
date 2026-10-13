import { useTranslation } from 'react-i18next';
import { Activity, Clock, Hash } from 'lucide-react';
import { useDashboard, useBandwidthHistory } from '@/hooks/use-dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { formatUptime, cn } from '@/lib/utils';
import type { TileProps } from './tile-types';

interface StatCellProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accentColor?: string;
  /** Small inline history sparkline, e.g. the last 20min of ping - see Sparkline below. */
  chart?: React.ReactNode;
}

/** The body of one single-number tile: label, value, optional sub line and history line. */
function StatCell({ icon: Icon, label, value, sub, accentColor = 'text-foreground', chart }: StatCellProps) {
  return (
    <div className="flex w-full items-center justify-between gap-3 p-5">
      <div className="min-w-0 flex-1">
        <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold font-mono-data leading-tight ${accentColor}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
        {chart && <div className="mt-1.5">{chart}</div>}
      </div>
      <Icon className={`h-4 w-4 shrink-0 ${accentColor}`} />
    </div>
  );
}

/** Minimal inline history line - no axes/labels, just the shape of the last N samples. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 100, h = 28;
  const max = Math.max(...values, 0.001);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('w-full h-7', className)} preserveAspectRatio="none">
      <polyline points={points} fill="none" style={{ stroke: 'hsl(var(--chart-4))' }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The online/max readout - an arc gauge driven by the real ratio, not decorative. */
function ArcGauge({ percent }: { percent: number }) {
  const radius = 78;
  const arcLength = Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(percent) ? percent : 0));
  const d = `M22 107 A${radius} ${radius} 0 0 1 178 107`;
  return (
    <svg width="200" height="115" viewBox="0 0 200 115" className="overflow-visible">
      <path d={d} fill="none" style={{ stroke: 'hsl(var(--secondary))' }} strokeWidth="14" strokeLinecap="round" />
      <path
        d={d}
        fill="none"
        style={{ stroke: 'hsl(var(--primary))' }}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray={arcLength}
        strokeDashoffset={arcLength * (1 - clamped)}
      />
    </svg>
  );
}

export function OnlineUsersTile({ className }: TileProps) {
  const { t } = useTranslation();
  const { data } = useDashboard();
  if (!data) return null;
  return (
    <Card className={cn('card-hero', className)}>
      <CardContent className="p-6 flex h-full flex-col items-center justify-center text-center">
        <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t('pages.dashboard.onlineUsers')}</p>
        <ArcGauge percent={data.maxClients ? data.onlineUsers / data.maxClients : 0} />
        <p className="text-4xl font-bold font-mono-data text-primary -mt-4">
          {data.onlineUsers}<span className="text-lg font-medium text-muted-foreground">/{data.maxClients}</span>
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">{t('pages.dashboard.ofSlots', { max: data.maxClients })}</p>
      </CardContent>
    </Card>
  );
}

export function ChannelsTile({ className }: TileProps) {
  const { t } = useTranslation();
  const { data } = useDashboard();
  if (!data) return null;
  return (
    <Card className={cn('card-hero', className)}>
      <CardContent className="p-0 flex h-full">
        <StatCell icon={Hash} label={t('pages.dashboard.channels')} value={data.channelCount} accentColor="text-violet-400" />
      </CardContent>
    </Card>
  );
}

export function UptimeTile({ className }: TileProps) {
  const { t } = useTranslation();
  const { data } = useDashboard();
  if (!data) return null;
  return (
    <Card className={cn('card-hero', className)}>
      <CardContent className="p-0 flex h-full">
        <StatCell icon={Clock} label={t('pages.dashboard.uptime')} value={formatUptime(data.uptime)} accentColor="text-emerald-400" />
      </CardContent>
    </Card>
  );
}

export function PingTile({ className }: TileProps) {
  const { t } = useTranslation();
  const { data } = useDashboard();
  const { data: history } = useBandwidthHistory();
  if (!data) return null;
  // Clamps unreachable (-1) samples to 0 so one bad tick doesn't spike the
  // sparkline - the headline value still shows "timeout" for those.
  const pingValues = ((history ?? []) as { ping?: number }[]).map((s) => Math.max(0, s.ping ?? 0));
  return (
    <Card className={cn('card-hero', className)}>
      <CardContent className="p-0 flex h-full">
        <StatCell
          icon={Activity}
          label={t('pages.dashboard.ping')}
          value={data.ping < 0 ? t('pages.dashboard.timeout') : `${data.ping}ms`}
          sub={data.pingTarget ? `→ ${data.pingTarget}` : undefined}
          accentColor={data.ping < 0 ? 'text-destructive' : 'text-amber-400'}
          chart={<Sparkline values={pingValues} />}
        />
      </CardContent>
    </Card>
  );
}
