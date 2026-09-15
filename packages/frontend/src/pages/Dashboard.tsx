import { useDashboard, useBandwidthHistory } from '@/hooks/use-dashboard';
import { useVirtualServers } from '@/hooks/use-servers';
import { useBots } from '@/hooks/use-bots';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { WidgetManagerModal } from '@/components/widget/WidgetManagerModal';
import { formatBytes, formatUptime, cn } from '@/lib/utils';
import { Activity, Clock, Hash, ArrowDownToLine, ArrowUpFromLine, Wifi, Server, LayoutGrid, Lock, Bot } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer } from 'recharts';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router';

interface SatelliteStatProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accentColor?: string;
  compact?: boolean;
  /** Small inline history sparkline, e.g. the last ~10min of ping - see Sparkline below. */
  chart?: React.ReactNode;
}

/** One stat inside the unified hero card below - no border/background of its own, just padding;
    the surrounding card supplies the one shared border for the whole section. */
function StatCell({ icon: Icon, label, value, sub, accentColor = 'text-foreground', compact, chart }: SatelliteStatProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3', compact ? 'p-3' : 'p-5')}>
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

/** The dashboard's one hero readout - an arc gauge driven by the real online/max ratio, not decorative. */
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

interface DashboardBotFlow {
  id: number;
  name: string;
  enabled: boolean;
}

/** Visible to everyone (view-only awareness of what's automated on this server); only clickable
    through to the editor for a user who actually has bot-flow permissions - the editor route
    itself redirects anyone else straight back here, which would otherwise look like a dead click. */
function BotFlowRow({ flow, canEdit }: { flow: DashboardBotFlow; canEdit: boolean }) {
  const inner = (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-1 py-2 border-b border-border last:border-b-0',
        canEdit && 'hover:bg-muted/50 -mx-1 px-2 rounded-sm transition-colors',
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm truncate">{flow.name}</span>
      </div>
      <Badge variant={flow.enabled ? 'success' : 'secondary'} className="text-[10px] shrink-0">
        {flow.enabled ? 'Active' : 'Inactive'}
      </Badge>
    </div>
  );
  return canEdit ? <Link to={`/bots/${flow.id}`}>{inner}</Link> : inner;
}

const formatSampleTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Matches the backend BandwidthSampler: 10s interval, 90 samples = 15 minutes.
const MAX_BANDWIDTH_POINTS = 90;

export default function Dashboard() {
  const { selectedConfigId, selectedSid } = useServerStore();
  const { data, isLoading, error } = useDashboard();
  const { data: bandwidthHistoryData } = useBandwidthHistory();
  // Only consulted for its error - ServerSelector already fetches this same
  // query (same key, shared cache) to drive the header dropdown. If it 403s,
  // selectedSid silently never gets set there, and without checking this
  // here too the "no access" case would be indistinguishable from a viewer
  // genuinely just not having picked a server yet.
  const { error: virtualServersError } = useVirtualServers();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const canManageBotFlows = useAuthStore((s) => s.canManageBotFlows());
  const { data: allBots } = useBots();
  const serverBotFlows = (allBots ?? []).filter(
    (b: any) => b.serverConfigId === selectedConfigId && String(b.virtualServerId) === String(selectedSid),
  );
  const [bandwidthHistory, setBandwidthHistory] = useState<any[]>([]);
  const [showWidgets, setShowWidgets] = useState(false);
  const seededServerRef = useRef<string | null>(null);

  // Seed the chart from the backend's rolling history buffer once per
  // selected server, so it shows the last ~15min immediately instead of
  // starting empty and only filling in from this point onward. React Query
  // already keys bandwidthHistoryData by (configId, sid), so switching
  // servers naturally clears it to undefined until the new server's history
  // loads (or is already cached) - no separate reset effect needed, and one
  // is actively wrong here since it would run on mount too and wipe out the
  // seed that just happened in the same commit.
  useEffect(() => {
    const serverKey = `${selectedConfigId}:${selectedSid}`;
    if (seededServerRef.current === serverKey) return;
    if (!bandwidthHistoryData) {
      setBandwidthHistory([]);
      return;
    }
    seededServerRef.current = serverKey;
    setBandwidthHistory(
      bandwidthHistoryData.map((s: { timestamp: number; incoming: number; outgoing: number; ping?: number }) => ({
        time: formatSampleTime(s.timestamp),
        in: s.incoming,
        out: s.outgoing,
        ping: s.ping ?? -1,
      })),
    );
  }, [bandwidthHistoryData, selectedConfigId, selectedSid]);

  // Append the live 10s poll on top of the seeded history.
  useEffect(() => {
    if (data) {
      setBandwidthHistory((prev) => {
        const next = [
          ...prev,
          {
            time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            in: data.bandwidth.incoming,
            out: data.bandwidth.outgoing,
            ping: data.ping,
          },
        ];
        return next.slice(-MAX_BANDWIDTH_POINTS);
      });
    }
  }, [data]);

  // Last ~10min at the sampler's 10s cadence, clamping unreachable (-1) samples to 0 so one bad
  // tick doesn't spike the sparkline - the headline value above still shows "timeout" for those.
  const pingSparklineValues = bandwidthHistory.slice(-60).map((s) => Math.max(0, s.ping ?? 0));

  if (!selectedConfigId || !selectedSid) {
    const isForbidden = (virtualServersError as any)?.response?.status === 403;
    return isForbidden ? (
      <EmptyState
        icon={Lock}
        title="No access to this server"
        description="Your account isn't granted access to this server connection. Ask an admin to grant it in Settings → Users."
      />
    ) : (
      <EmptyState
        icon={Server}
        title="No server selected"
        description="Select a server connection from the header to view the dashboard."
      />
    );
  }

  if (isLoading) return <PageLoader />;
  if (error || !data) {
    const isForbidden = (error as any)?.response?.status === 403;
    return isForbidden ? (
      <EmptyState
        icon={Lock}
        title="No access to this server"
        description="Your account isn't granted access to this server connection. Ask an admin to grant it in Settings → Users."
      />
    ) : (
      <EmptyState
        icon={Wifi}
        title="Connection failed"
        description="Could not connect to the TeamSpeak server. Check your connection settings."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{data.serverName}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="success" className="font-mono-data text-[10px]">ONLINE</Badge>
            <span className="text-xs text-muted-foreground font-mono-data">{data.version} / {data.platform}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowWidgets(true)}>
              <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> Widgets
            </Button>
          )}
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground font-mono-data uppercase tracking-widest">Live Monitoring</p>
            <div className="flex items-center gap-1 justify-end mt-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
              <span className="text-[10px] text-emerald-400 font-mono-data">ACTIVE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Hero + satellite cluster, all one field per the user's own preference (matching the
          mockup more closely than the first pass, which had split this into 4 separate boxes):
          Online Users is the one number this whole page exists to show at a glance, so it gets
          the dominant arc readout; everything else sits alongside it in the same card. */}
      <Card className="card-hero">
        <CardContent className="p-0">
          <div className="flex flex-col lg:flex-row">
            <div className="p-6 flex flex-col items-center justify-center text-center lg:w-80 shrink-0">
              <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Online Users</p>
              <ArcGauge percent={data.maxClients ? data.onlineUsers / data.maxClients : 0} />
              <p className="text-4xl font-bold font-mono-data text-primary -mt-4">
                {data.onlineUsers}<span className="text-lg font-medium text-muted-foreground">/{data.maxClients}</span>
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">of {data.maxClients} slots</p>
            </div>
            <div className="flex-1 flex flex-col justify-center">
              <StatCell icon={Hash} label="Channels" value={data.channelCount} accentColor="text-violet-400" compact />
              <StatCell icon={Clock} label="Uptime" value={formatUptime(data.uptime)} accentColor="text-emerald-400" compact />
              <StatCell
                icon={Activity}
                label="Ping"
                value={data.ping < 0 ? 'timeout' : `${data.ping}ms`}
                sub={data.pingTarget ? `→ ${data.pingTarget}` : undefined}
                accentColor={data.ping < 0 ? 'text-destructive' : 'text-amber-400'}
                compact
                chart={<Sparkline values={pingSparklineValues} />}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bandwidth + Detail panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bandwidth Chart */}
        <Card className="card-hero lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Bandwidth
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
                      formatter={(value, name) => [formatBytes(Number(value) || 0) + '/s', name === 'in' ? 'Download' : 'Upload']}
                    />
                    <Area type="monotone" dataKey="in" stroke="hsl(var(--chart-1))" fill="url(#inGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="out" stroke="hsl(var(--chart-3))" fill="url(#outGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground font-mono-data">
                  Collecting data...
                </div>
              )}
            </div>
            <div className="flex items-center gap-6 mt-3">
              <div className="flex items-center gap-2 text-xs">
                <ArrowDownToLine className="h-3.5 w-3.5 text-primary" />
                <span className="text-muted-foreground">In:</span>
                <span className="font-mono-data text-primary">{formatBytes(data.bandwidth.incoming)}/s</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <ArrowUpFromLine className="h-3.5 w-3.5 text-violet-400" />
                <span className="text-muted-foreground">Out:</span>
                <span className="font-mono-data text-violet-400">{formatBytes(data.bandwidth.outgoing)}/s</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Capacity */}
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Server Capacity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">User Slots</span>
                <span className="font-mono-data">{data.onlineUsers} / {data.maxClients}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-linear-to-r from-primary to-primary/60 transition-all duration-500"
                  style={{ width: `${Math.min((data.onlineUsers / data.maxClients) * 100, 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 font-mono-data">
                {((data.onlineUsers / data.maxClients) * 100).toFixed(1)}% utilized
              </p>
            </div>

            <div className="pt-3 border-t border-border space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Server Version</span>
                <span className="font-mono-data text-foreground">{data.version?.split(' ')[0]}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Platform</span>
                <span className="font-mono-data text-foreground">{data.platform}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Channels</span>
                <span className="font-mono-data text-foreground">{data.channelCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Uptime</span>
                <span className="font-mono-data text-emerald-400">{formatUptime(data.uptime)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {serverBotFlows.length > 0 && (
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              Bot Flows
              <span className="font-mono-data text-[11px] text-muted-foreground/70 font-normal">({serverBotFlows.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {serverBotFlows.map((flow: DashboardBotFlow) => (
              <BotFlowRow key={flow.id} flow={flow} canEdit={canManageBotFlows} />
            ))}
          </CardContent>
        </Card>
      )}

      <WidgetManagerModal open={showWidgets} onOpenChange={setShowWidgets} />
    </div>
  );
}
