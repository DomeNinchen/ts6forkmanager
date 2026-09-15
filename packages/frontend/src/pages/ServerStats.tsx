import { useVirtualServerInfo, useConnectionInfo } from '@/hooks/use-servers';
import { useServerStore } from '@/stores/server.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatUptime, formatBytes } from '@/lib/utils';
import { BarChart3, Info, Users, Activity, ArrowUpDown } from 'lucide-react';

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono-data font-medium">{value ?? '-'}</span>
    </div>
  );
}

export default function ServerStats() {
  const { selectedSid } = useServerStore();
  const { data: info, isLoading: loadingInfo } = useVirtualServerInfo();
  const { data: conn, isLoading: loadingConn } = useConnectionInfo();

  if (!selectedSid) {
    return <EmptyState icon={BarChart3} title="No server selected" description="Select a server under Virtual Servers first." />;
  }
  if (loadingInfo || loadingConn) return <PageLoader />;

  const s = Array.isArray(info) ? info[0] : info;
  const c = Array.isArray(conn) ? conn[0] : conn;
  if (!s) return <EmptyState icon={BarChart3} title="No data" description="Could not load statistics for this server." />;

  const regularClients = Number(s.virtualserver_clientsonline || 0) - Number(s.virtualserver_queryclientsonline || 0);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Statistics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Info className="h-4 w-4 text-primary" /> General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatRow label="Name" value={s.virtualserver_name} />
            <StatRow label="Status" value={
              <Badge variant={s.virtualserver_status === 'online' ? 'success' : 'secondary'} className="text-[10px]">
                {String(s.virtualserver_status).toUpperCase()}
              </Badge>
            } />
            <StatRow label="ID" value={s.virtualserver_id} />
            <StatRow label="Port" value={s.virtualserver_port} />
            <StatRow label="Autostart" value={
              <Badge variant={Number(s.virtualserver_autostart) === 1 ? 'success' : 'secondary'} className="text-[10px]">
                {Number(s.virtualserver_autostart) === 1 ? 'ON' : 'OFF'}
              </Badge>
            } />
            <StatRow label="Uptime" value={formatUptime(Number(s.virtualserver_uptime || 0))} />
            <StatRow label="Created" value={s.virtualserver_created ? new Date(Number(s.virtualserver_created) * 1000).toLocaleString() : '-'} />
          </CardContent>
        </Card>

        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Connections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatRow label="Regular Clients" value={regularClients} />
            <StatRow label="Query Clients" value={s.virtualserver_queryclientsonline} />
            <StatRow label="Channels" value={s.virtualserver_channelsonline} />
            <StatRow label="Slots" value={`${s.virtualserver_clientsonline} / ${s.virtualserver_maxclients}`} />
          </CardContent>
        </Card>

        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Network</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatRow label="Packet Loss" value={c ? `${Number(c.connection_packetloss_total).toFixed(2)}%` : '-'} />
            <StatRow label="Ping" value={c ? `${Number(c.connection_ping).toFixed(0)} ms` : '-'} />
            <StatRow label="Current Upload" value={c ? `${formatBytes(Number(c.connection_bandwidth_sent_last_second_total))}/s` : '-'} />
            <StatRow label="Current Download" value={c ? `${formatBytes(Number(c.connection_bandwidth_received_last_second_total))}/s` : '-'} />
          </CardContent>
        </Card>

        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><ArrowUpDown className="h-4 w-4 text-primary" /> Traffic Since Start</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatRow label="Sent" value={c ? formatBytes(Number(c.connection_bytes_sent_total)) : '-'} />
            <StatRow label="Received" value={c ? formatBytes(Number(c.connection_bytes_received_total)) : '-'} />
            <StatRow label="Total" value={c ? formatBytes(Number(c.connection_bytes_sent_total) + Number(c.connection_bytes_received_total)) : '-'} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
