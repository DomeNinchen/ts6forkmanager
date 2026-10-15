import { useDashboard } from '@/hooks/use-dashboard';
import { useVirtualServers } from '@/hooks/use-servers';
import { useUserSettings, useSaveUserSetting } from '@/hooks/use-user-settings';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { WidgetManagerModal } from '@/components/widget/WidgetManagerModal';
import { DEFAULT_LAYOUT, TILE_WIDTH_CLASS, isDefaultLayout, resolveLayout, tileDef } from '@/components/dashboard/tile-registry';
import { TileLayoutEditor } from '@/components/dashboard/TileLayoutEditor';
import { Wifi, Server, LayoutGrid, Lock, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import type { DashboardTileSetting } from '@ts6/common';
import { useClients } from '@/hooks/use-clients';
import { useDesign } from '@/hooks/use-webgui-theme';
import { cn } from '@/lib/utils';

/** The single-number tiles; Lounge's lead sentence says all of them, so its tile grid leaves them out. */
const SAID_IN_LEAD = new Set(['onlineUsers', 'channels', 'uptime', 'ping']);

/** How long the server has been up, in its largest whole unit, as a phrase. */
function uptimePhrase(t: TFunction, seconds: number) {
  const days = Math.floor(seconds / 86400);
  if (days > 0) return t('pages.dashboard.lead.upDays', { count: days });
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return t('pages.dashboard.lead.upHours', { count: hours });
  return t('pages.dashboard.lead.upMinutes', { count: Math.max(1, Math.floor(seconds / 60)) });
}

/**
 * The Lounge dashboard's opening sentence: who is here (voice clients only, no query logins),
 * how long the server has been up, channels and ping - in words instead of tiles.
 */
function Lead({ uptime, channelCount, ping }: { uptime: number; channelCount: number; ping: number }) {
  const { t } = useTranslation();
  const { data: clients } = useClients();
  const people = ((clients ?? []) as any[]).filter((c) => String(c.client_type) === '0').length;

  return (
    <p className="mt-6 max-w-[30ch] font-display text-3xl font-medium leading-snug sm:text-[2.6rem]">
      {people ? t('pages.dashboard.lead.peopleHere', { count: people }) : t('pages.dashboard.lead.nobodyHere')}.{' '}
      {uptimePhrase(t, uptime)},{' '}
      {ping < 0
        ? t('pages.dashboard.lead.channelsNoPing', { count: channelCount })
        : t('pages.dashboard.lead.channelsPing', { count: channelCount, ping })}
    </p>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const lounge = useDesign() === 'lounge';
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

  // The user's own tile layout. If it cannot be loaded the default is shown - the dashboard itself still works.
  const { data: settings, isLoading: settingsLoading } = useUserSettings();
  const saveLayout = useSaveUserSetting('dashboardLayout');
  const layout = resolveLayout(settings?.dashboardLayout);
  /** The layout being edited; null outside the customise mode. */
  const [draft, setDraft] = useState<DashboardTileSetting[] | null>(null);

  const saveDraft = () => {
    if (!draft) return;
    saveLayout.mutate(isDefaultLayout(draft) ? null : { tiles: draft }, {
      onSuccess: () => {
        setDraft(null);
        toast.success(t('pages.dashboard.tiles.saved'));
      },
      onError: () => toast.error(t('pages.dashboard.tiles.saveFailed')),
    });
  };

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

  if (isLoading || settingsLoading) return <PageLoader />;
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
    <div className="space-y-5 lounge:space-y-8">
      {/* Header */}
      <div className={cn('flex flex-wrap justify-between gap-3', lounge ? 'items-start gap-x-6 gap-y-4' : 'items-center')}>
        {lounge ? (
          <div className="min-w-0">
            <h1 data-hero className="font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-7xl">{data.serverName}</h1>
            <Lead uptime={data.uptime} channelCount={data.channelCount} ping={data.ping} />
            <p className="mt-5 text-sm text-muted-foreground">TeamSpeak {data.version}, {data.platform}</p>
          </div>
        ) : (
          <div>
            <h1 className="text-xl font-semibold">{data.serverName}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="success" className="font-mono-data text-[10px]">{t('common.online').toUpperCase()}</Badge>
              <span className="text-xs text-muted-foreground font-mono-data">{data.version} / {data.platform}</span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {draft ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setDraft(DEFAULT_LAYOUT)} disabled={saveLayout.isPending}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> {t('common.reset')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={saveLayout.isPending}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={saveDraft} disabled={saveLayout.isPending}>
                {saveLayout.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setDraft(layout)}>
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> {t('pages.dashboard.tiles.customise')}
              </Button>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setShowWidgets(true)}>
                  <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> {t('pages.dashboard.widgets')}
                </Button>
              )}
            </>
          )}
          {!lounge && (
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground font-mono-data uppercase tracking-widest">{t('pages.dashboard.liveMonitoring')}</p>
              <div className="flex items-center gap-1 justify-end mt-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
                <span className="text-[10px] text-emerald-400 font-mono-data">{t('common.active').toUpperCase()}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {draft ? (
        <>
          <p className="text-sm text-muted-foreground">{t('pages.dashboard.tiles.editHint')}</p>
          <TileLayoutEditor layout={draft} onChange={setDraft} />
        </>
      ) : (
        /* The tiles. Each loads its own data and renders nothing when it has nothing to show.
           Lounge leaves out the four single-number tiles - its lead sentence says what they say. */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lounge:gap-x-10 lounge:gap-y-8 lounge:pt-4">
          {layout.filter((tile) => !tile.hidden && !(lounge && SAID_IN_LEAD.has(tile.id))).map(({ id, width }) => {
            const Tile = tileDef(id)?.component;
            return Tile && <Tile key={id} className={TILE_WIDTH_CLASS[width]} />;
          })}
        </div>
      )}

      {/* The dialog loads the widget list the moment it mounts, and only an admin may read it - the button that opens it is admin-only too. */}
      {isAdmin && <WidgetManagerModal open={showWidgets} onOpenChange={setShowWidgets} />}
    </div>
  );
}
