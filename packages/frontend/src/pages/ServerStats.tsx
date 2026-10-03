import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useVirtualServerInfo, useConnectionInfo, useHostInfo, useVirtualServers } from '@/hooks/use-servers';
import { useServerStore } from '@/stores/server.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { UserHistoryTab } from '@/components/statistics/UserHistoryTab';
import { formatUptime, formatBytes } from '@/lib/utils';
import { BarChart3, Info, Users, Activity, ArrowUpDown, Server, LayoutGrid } from 'lucide-react';

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono-data font-medium">{value ?? '-'}</span>
    </div>
  );
}

function OverviewTab() {
  const { t } = useTranslation();
  const { selectedConfigId } = useServerStore();
  const { data: host, isLoading: loadingHost } = useHostInfo();
  const { data: serverList, isLoading: loadingServers } = useVirtualServers();

  if (!selectedConfigId) return <EmptyState icon={Server} title={t('pages.serverStats.noConnectionSelected')} />;
  if (loadingHost || loadingServers) return <PageLoader />;

  const h = Array.isArray(host) ? host[0] : host;
  const servers = Array.isArray(serverList) ? serverList : [];
  const online = servers.filter((s: any) => s.virtualserver_status === 'online').length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><LayoutGrid className="h-4 w-4 text-primary" /> {t('nav.items.virtualServers')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatRow label={t('pages.serverStats.serversOnline')} value={`${online} / ${servers.length}`} />
          <StatRow label={t('pages.serverStats.users')} value={h ? `${h.virtualservers_total_clients_online} / ${h.virtualservers_total_maxclients}` : '-'} />
          <StatRow label={t('nav.items.channels')} value={h?.virtualservers_total_channels_online} />
          <StatRow label={t('pages.serverStats.instanceUptime')} value={h ? formatUptime(Number(h.instance_uptime || 0)) : '-'} />
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> {t('pages.serverStats.currentBandwidth')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatRow label={t('pages.serverStats.uploadSecond')} value={h ? `${formatBytes(Number(h.connection_bandwidth_sent_last_second_total))}/s` : '-'} />
          <StatRow label={t('pages.serverStats.uploadMinute')} value={h ? `${formatBytes(Number(h.connection_bandwidth_sent_last_minute_total))}/s` : '-'} />
          <StatRow label={t('pages.serverStats.downloadSecond')} value={h ? `${formatBytes(Number(h.connection_bandwidth_received_last_second_total))}/s` : '-'} />
          <StatRow label={t('pages.serverStats.downloadMinute')} value={h ? `${formatBytes(Number(h.connection_bandwidth_received_last_minute_total))}/s` : '-'} />
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><ArrowUpDown className="h-4 w-4 text-primary" /> {t('pages.serverStats.transferredSinceStart')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatRow label={t('pages.serverStats.dataSent')} value={h ? formatBytes(Number(h.connection_bytes_sent_total)) : '-'} />
          <StatRow label={t('pages.serverStats.dataReceived')} value={h ? formatBytes(Number(h.connection_bytes_received_total)) : '-'} />
          <StatRow label={t('pages.serverStats.packetsSent')} value={h?.connection_packets_sent_total} />
          <StatRow label={t('pages.serverStats.packetsReceived')} value={h?.connection_packets_received_total} />
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Server className="h-4 w-4 text-primary" /> {t('pages.serverStats.fileTransfersSinceStart')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatRow label={t('pages.serverStats.filesSent')} value={h ? formatBytes(Number(h.connection_filetransfer_bytes_sent_total)) : '-'} />
          <StatRow label={t('pages.serverStats.filesReceived')} value={h ? formatBytes(Number(h.connection_filetransfer_bytes_received_total)) : '-'} />
        </CardContent>
      </Card>
    </div>
  );
}

function SelectedServerTab() {
  const { t } = useTranslation();
  const { selectedSid } = useServerStore();
  const { data: info, isLoading: loadingInfo } = useVirtualServerInfo();
  const { data: conn, isLoading: loadingConn } = useConnectionInfo();

  if (!selectedSid) {
    return <EmptyState icon={BarChart3} title={t('pages.noServerSelected')} description={t('pages.serverStats.selectServerFirst')} />;
  }
  if (loadingInfo || loadingConn) return <PageLoader />;

  const s = Array.isArray(info) ? info[0] : info;
  const c = Array.isArray(conn) ? conn[0] : conn;
  if (!s) return <EmptyState icon={BarChart3} title={t('pages.serverStats.noData')} description={t('pages.serverStats.couldNotLoad')} />;

  const regularClients = Number(s.virtualserver_clientsonline || 0) - Number(s.virtualserver_queryclientsonline || 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> {t('pages.serverStats.general')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatRow label={t('common.name')} value={s.virtualserver_name} />
          <StatRow label={t('common.status')} value={
            <Badge variant={s.virtualserver_status === 'online' ? 'success' : 'secondary'} className="text-[10px]">
              {String(s.virtualserver_status).toUpperCase()}
            </Badge>
          } />
          <StatRow label="ID" value={s.virtualserver_id} />
          <StatRow label={t('pages.serverStats.port')} value={s.virtualserver_port} />
          <StatRow label={t('pages.serverStats.autostart')} value={
            <Badge variant={Number(s.virtualserver_autostart) === 1 ? 'success' : 'secondary'} className="text-[10px]">
              {Number(s.virtualserver_autostart) === 1 ? t('common.on') : t('common.off')}
            </Badge>
          } />
          <StatRow label={t('pages.serverStats.uptime')} value={formatUptime(Number(s.virtualserver_uptime || 0))} />
          <StatRow label={t('pages.serverStats.created')} value={s.virtualserver_created ? new Date(Number(s.virtualserver_created) * 1000).toLocaleString() : '-'} />
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> {t('pages.serverStats.connections')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatRow label={t('pages.serverStats.regularClients')} value={regularClients} />
          <StatRow label={t('pages.serverStats.queryClients')} value={s.virtualserver_queryclientsonline} />
          <StatRow label={t('nav.items.channels')} value={s.virtualserver_channelsonline} />
          <StatRow label={t('pages.serverStats.slots')} value={`${s.virtualserver_clientsonline} / ${s.virtualserver_maxclients}`} />
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> {t('pages.serverStats.network')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatRow label={t('pages.serverStats.packetLoss')} value={c ? `${Number(c.connection_packetloss_total).toFixed(2)}%` : '-'} />
          <StatRow label={t('pages.serverStats.ping')} value={c ? `${Number(c.connection_ping).toFixed(0)} ms` : '-'} />
          <StatRow label={t('pages.serverStats.currentUpload')} value={c ? `${formatBytes(Number(c.connection_bandwidth_sent_last_second_total))}/s` : '-'} />
          <StatRow label={t('pages.serverStats.currentDownload')} value={c ? `${formatBytes(Number(c.connection_bandwidth_received_last_second_total))}/s` : '-'} />
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><ArrowUpDown className="h-4 w-4 text-primary" /> {t('pages.serverStats.trafficSinceStart')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <StatRow label={t('pages.serverStats.sent')} value={c ? formatBytes(Number(c.connection_bytes_sent_total)) : '-'} />
          <StatRow label={t('pages.serverStats.received')} value={c ? formatBytes(Number(c.connection_bytes_received_total)) : '-'} />
          <StatRow label={t('pages.serverStats.total')} value={c ? formatBytes(Number(c.connection_bytes_sent_total) + Number(c.connection_bytes_received_total)) : '-'} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function ServerStats() {
  const { t } = useTranslation();
  // The dashboard's history card links to /server-stats?tab=history.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const initialTab = requestedTab === 'history' || requestedTab === 'selected' ? requestedTab : 'overview';
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('nav.items.statistics')}</h1>

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="overview">{t('pages.serverStats.overview')}</TabsTrigger>
          <TabsTrigger value="selected">{t('pages.serverStats.selectedServer')}</TabsTrigger>
          <TabsTrigger value="history">{t('pages.serverStats.history.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="selected" className="mt-4">
          <SelectedServerTab />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          <UserHistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
