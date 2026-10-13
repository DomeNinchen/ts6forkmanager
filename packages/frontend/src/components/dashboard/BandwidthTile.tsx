import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer } from 'recharts';
import { useDashboard, useBandwidthHistory } from '@/hooks/use-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBytes, cn } from '@/lib/utils';
import type { TileProps } from './tile-types';

const formatSampleTime = (ms: number, locale: string) =>
  new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** One measurement as the backend's /bandwidth-history endpoint returns it. */
interface BandwidthSample {
  timestamp: number;
  incoming: number;
  outgoing: number;
  ping?: number;
}

/** The same measurement in the shape the chart plots. */
interface ChartPoint {
  time: string;
  in: number;
  out: number;
}

export function BandwidthTile({ className }: TileProps) {
  const { t, i18n } = useTranslation();
  const { data } = useDashboard();
  const { data: bandwidthHistoryData } = useBandwidthHistory();

  // Straight from the backend's measurements - the tile keeps no history state
  // of its own. The sampler runs continuously whether or not anyone is looking,
  // so this is already the full 20-minute window on the very first render
  // rather than a chart that starts empty and fills in while you watch it.
  // Appending live points here instead would mix the dashboard's own 10s poll
  // into the sampler's 30s cadence and, within a few minutes, push the real
  // history out of the window entirely.
  const bandwidthHistory = useMemo<ChartPoint[]>(
    () =>
      ((bandwidthHistoryData ?? []) as BandwidthSample[]).map((s) => ({
        time: formatSampleTime(s.timestamp, i18n.language),
        in: s.incoming,
        out: s.outgoing,
      })),
    [bandwidthHistoryData, i18n.language],
  );

  if (!data) return null;
  return (
    <Card className={cn('card-hero', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {t('pages.dashboard.bandwidth')}
          <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">{t('pages.dashboard.last20Minutes')}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px]">
          {bandwidthHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={bandwidthHistory}>
                <defs>
                  <linearGradient id="inGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-3))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatBytes(v)} width={60} />
                <ReTooltip
                  contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }}
                  labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
                  formatter={(value, name) => [formatBytes(Number(value) || 0) + '/s', name === 'in' ? t('pages.dashboard.download') : t('pages.dashboard.upload')]}
                />
                <Area type="monotone" dataKey="in" stroke="hsl(var(--chart-1))" fill="url(#inGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="out" stroke="hsl(var(--chart-3))" fill="url(#outGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground font-mono-data">
              {t('pages.dashboard.collectingData')}
            </div>
          )}
        </div>
        <div className="flex items-center gap-6 mt-3">
          <div className="flex items-center gap-2 text-xs">
            <ArrowDownToLine className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">{t('pages.dashboard.in')}</span>
            <span className="font-mono-data text-primary">{formatBytes(data.bandwidth.incoming)}/s</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <ArrowUpFromLine className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-muted-foreground">{t('pages.dashboard.out')}</span>
            <span className="font-mono-data text-violet-400">{formatBytes(data.bandwidth.outgoing)}/s</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
