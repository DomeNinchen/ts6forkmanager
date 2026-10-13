import { useTranslation } from 'react-i18next';
import { useDashboard } from '@/hooks/use-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUptime, cn } from '@/lib/utils';
import type { TileProps } from './tile-types';

export function CapacityTile({ className }: TileProps) {
  const { t } = useTranslation();
  const { data } = useDashboard();
  if (!data) return null;
  return (
    <Card className={cn('card-hero', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{t('pages.dashboard.serverCapacity')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">{t('pages.dashboard.userSlots')}</span>
            <span className="font-mono-data">{data.onlineUsers} / {data.maxClients}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-linear-to-r from-primary to-primary/60 transition-all duration-500"
              style={{ width: `${Math.min((data.onlineUsers / data.maxClients) * 100, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 font-mono-data">
            {t('pages.dashboard.utilized', { percent: ((data.onlineUsers / data.maxClients) * 100).toFixed(1) })}
          </p>
        </div>

        <div className="pt-3 border-t border-border space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t('pages.dashboard.serverVersion')}</span>
            <span className="font-mono-data text-foreground">{data.version?.split(' ')[0]}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t('pages.dashboard.platform')}</span>
            <span className="font-mono-data text-foreground">{data.platform}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t('pages.dashboard.channels')}</span>
            <span className="font-mono-data text-foreground">{data.channelCount}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{t('pages.dashboard.uptime')}</span>
            <span className="font-mono-data text-emerald-400">{formatUptime(data.uptime)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
