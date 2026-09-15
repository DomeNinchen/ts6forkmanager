import { useMemo, useState } from 'react';
import { useVirtualServers, useCreateVirtualServer } from '@/hooks/use-servers';
import { useServerStore } from '@/stores/server.store';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatUptime, cn } from '@/lib/utils';
import { Server, Play, Square, Users, Clock, Plus, Power, Layers, Check } from 'lucide-react';
import { serversApi } from '@/api/servers.api';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

function CounterTile({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold font-mono-data leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1">{label}{sub && <span className="text-muted-foreground/60"> · {sub}</span>}</p>
      </div>
    </div>
  );
}

export default function VirtualServers() {
  const { selectedConfigId, selectedSid, setSid } = useServerStore();
  const { data, isLoading } = useVirtualServers();
  const createVirtual = useCreateVirtualServer();
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', maxclients: 32, port: '', autostart: false });

  const servers = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const counters = useMemo(() => {
    const online = servers.filter((s: any) => s.virtualserver_status === 'online').length;
    const offline = servers.length - online;
    const autostartServers = servers.filter((s: any) => Number(s.virtualserver_autostart) === 1);

    const totalSlots = servers.reduce((sum: number, s: any) => {
      const max = s.virtualserver_maxclients;
      return max != null ? sum + Number(max) : sum;
    }, 0);

    // TeamSpeak doesn't always report a stopped server's slot count - if any
    // autostart-enabled server currently has no determinable maxclients, the
    // autostart-slots total can't be trusted, so it's omitted entirely rather
    // than shown as an inaccurate partial sum.
    const autostartSlotsKnown = autostartServers.every((s: any) => s.virtualserver_maxclients != null);
    const autostartSlots = autostartSlotsKnown
      ? autostartServers.reduce((sum: number, s: any) => sum + Number(s.virtualserver_maxclients), 0)
      : null;

    return { online, offline, autostartCount: autostartServers.length, totalSlots, autostartSlots };
  }, [servers]);

  if (!selectedConfigId) return <EmptyState icon={Server} title="No server selected" />;
  if (isLoading) return <PageLoader />;

  const handleStart = async (sid: number) => {
    try {
      await serversApi.startVirtual(selectedConfigId, sid);
      toast.success('Server started');
      qc.invalidateQueries({ queryKey: ['virtual-servers'] });
    } catch { toast.error('Failed to start server'); }
  };

  const handleStop = async (sid: number) => {
    try {
      await serversApi.stopVirtual(selectedConfigId, sid);
      toast.success('Server stopped');
      qc.invalidateQueries({ queryKey: ['virtual-servers'] });
    } catch { toast.error('Failed to stop server'); }
  };

  const handleCreate = () => {
    if (!form.name.trim()) return;
    const payload: Record<string, unknown> = {
      virtualserver_name: form.name,
      virtualserver_maxclients: form.maxclients,
      virtualserver_autostart: form.autostart ? 1 : 0,
    };
    if (form.port.trim()) payload.virtualserver_port = parseInt(form.port, 10);

    createVirtual.mutate(payload, {
      onSuccess: () => {
        toast.success('Virtual server created');
        setShowCreate(false);
        setForm({ name: '', maxclients: 32, port: '', autostart: false });
      },
      onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || 'Failed to create virtual server'),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Virtual Servers</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> Create Server
        </Button>
      </div>

      <Card className="card-hero">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <CounterTile icon={Server} label="Servers" sub="online+offline" value={`${counters.online}+${counters.offline}`} />
          <CounterTile icon={Power} label="Autostarting" value={String(counters.autostartCount)} />
          <CounterTile icon={Layers} label="Slots" value={String(counters.totalSlots)} />
          <CounterTile icon={Layers} label="Autostart Slots" value={counters.autostartSlots != null ? String(counters.autostartSlots) : '—'} />
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {servers.map((vs: any) => {
          const isSelected = String(selectedSid) === String(vs.virtualserver_id);
          return (
            <Card
              key={vs.virtualserver_id}
              className={cn(
                'card-hero transition-colors',
                isSelected ? 'border-primary' : 'hover:border-primary/30',
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                      <Server className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{vs.virtualserver_name}</span>
                        <Badge variant={vs.virtualserver_status === 'online' ? 'success' : 'secondary'} className="text-[10px]">
                          {vs.virtualserver_status?.toUpperCase()}
                        </Badge>
                        {isSelected && <Badge variant="outline" className="text-[10px] border-primary text-primary">SELECTED</Badge>}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span className="font-mono-data">SID: {vs.virtualserver_id}</span>
                        <span className="font-mono-data">Port: {vs.virtualserver_port}</span>
                        {vs.virtualserver_status === 'online' && (
                          <>
                            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {vs.virtualserver_clientsonline - (vs.virtualserver_queryclientsonline || 0)}/{vs.virtualserver_maxclients}</span>
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatUptime(vs.virtualserver_uptime || 0)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSelected ? (
                      <Button variant="outline" size="sm" onClick={() => setSid(null)}>
                        Deselect
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setSid(vs.virtualserver_id)}>
                        <Check className="h-3 w-3 mr-1" /> Select
                      </Button>
                    )}
                    {vs.virtualserver_status === 'online' ? (
                      <Button variant="outline" size="sm" onClick={() => handleStop(vs.virtualserver_id)}>
                        <Square className="h-3 w-3 mr-1" /> Stop
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => handleStart(vs.virtualserver_id)}>
                        <Play className="h-3 w-3 mr-1" /> Start
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Create Server Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Virtual Server</DialogTitle>
            <DialogDescription>Creates a new virtual server on this TeamSpeak instance.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My TeamSpeak Server" autoFocus />
            </div>
            <div>
              <Label className="text-xs">Slots</Label>
              <Input type="number" min={1} value={form.maxclients} onChange={(e) => setForm({ ...form, maxclients: parseInt(e.target.value) || 1 })} />
            </div>
            <div>
              <Label className="text-xs">Port (optional)</Label>
              <Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="Leave empty for first free port" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.autostart} onCheckedChange={(v) => setForm({ ...form, autostart: v })} />
              <Label className="text-xs">Autostart with the instance</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name.trim() || createVirtual.isPending}>
              {createVirtual.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
