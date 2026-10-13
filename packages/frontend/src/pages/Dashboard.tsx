import { useDashboard } from '@/hooks/use-dashboard';
import { useVirtualServers } from '@/hooks/use-servers';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { WidgetManagerModal } from '@/components/widget/WidgetManagerModal';
import { DASHBOARD_TILES, DEFAULT_LAYOUT, TILE_WIDTH_CLASS } from '@/components/dashboard/tile-registry';
import { Wifi, Server, LayoutGrid, Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function Dashboard() {
  const { t } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const { data, isLoading, error } = useDashboard();
  // Only consulted for its error - ServerSelector already fetches this same
  // query (same key, shared cache) to drive the header dropdown. If it 403s,
  // selectedSid silently never gets set there, and without checking this
  // here too the "no access" case would be indistinguishable from a viewer
  // genuinely just not having picked a server yet.
  const { error: virtualServersError } = useVirtualServers();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [showWidgets, setShowWidgets] = useState(false);

  if (!selectedConfigId || !selectedSid) {
    const isForbidden = (virtualServersError as any)?.response?.status === 403;
    return isForbidden ? (
      <EmptyState
        icon={Lock}
        title={t('pages.dashboard.noAccessTitle')}
        description={t('pages.dashboard.noAccessDescription')}
      />
    ) : (
      <EmptyState
        icon={Server}
        title={t('pages.noServerSelected')}
        description={t('pages.dashboard.noServerDescription')}
      />
    );
  }

  if (isLoading) return <PageLoader />;
  if (error || !data) {
    const isForbidden = (error as any)?.response?.status === 403;
    return isForbidden ? (
      <EmptyState
        icon={Lock}
        title={t('pages.dashboard.noAccessTitle')}
        description={t('pages.dashboard.noAccessDescription')}
      />
    ) : (
      <EmptyState
        icon={Wifi}
        title={t('pages.dashboard.connectionFailedTitle')}
        description={t('pages.dashboard.connectionFailedDescription')}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{data.serverName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="success" className="font-mono-data text-[10px]">{t('common.online').toUpperCase()}</Badge>
            <span className="text-xs text-muted-foreground font-mono-data">{data.version} / {data.platform}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowWidgets(true)}>
              <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> {t('pages.dashboard.widgets')}
            </Button>
          )}
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground font-mono-data uppercase tracking-widest">{t('pages.dashboard.liveMonitoring')}</p>
            <div className="flex items-center gap-1 justify-end mt-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
              <span className="text-[10px] text-emerald-400 font-mono-data">{t('common.active').toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* The tiles. Each loads its own data and renders nothing when it has nothing to show. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {DEFAULT_LAYOUT.map(({ id, width }) => {
          const Tile = DASHBOARD_TILES[id];
          return <Tile key={id} className={TILE_WIDTH_CLASS[width]} />;
        })}
      </div>

      {/* The dialog loads the widget list the moment it mounts, and only an admin may read it - the button that opens it is admin-only too. */}
      {isAdmin && <WidgetManagerModal open={showWidgets} onOpenChange={setShowWidgets} />}
    </div>
  );
}
