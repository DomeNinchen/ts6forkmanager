import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { serversApi } from '@/api/servers.api';
import { useServerStore } from '@/stores/server.store';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Cpu, Save, Server, Globe, Network } from 'lucide-react';
import { formatBytes, formatUptime } from '@/lib/utils';
import { toast } from 'sonner';

export default function Instance() {
  const { t } = useTranslation();
  const { selectedConfigId: c } = useServerStore();
  const qc = useQueryClient();
  const [editFields, setEditFields] = useState<Record<string, string>>({});

  const { data: info, isLoading: loadingInfo } = useQuery({
    queryKey: ['instance-info', c],
    queryFn: () => serversApi.instanceInfo(c!),
    enabled: !!c,
  });
  const { data: host, isLoading: loadingHost } = useQuery({
    queryKey: ['host-info', c],
    queryFn: () => serversApi.hostInfo(c!),
    enabled: !!c,
  });
  const { data: version } = useQuery({
    queryKey: ['version', c],
    queryFn: () => serversApi.version(c!),
    enabled: !!c,
  });
  const { data: bindings } = useQuery({
    queryKey: ['instance-bindings', c],
    queryFn: () => serversApi.bindings(c!),
    enabled: !!c,
  });

  const editMutation = useMutation({
    mutationFn: (data: any) => serversApi.instanceEdit(c!, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['instance-info', c] }); toast.success(t('pages.instance.updated')); setEditFields({}); },
    onError: () => toast.error(t('pages.instance.updateFailed')),
  });

  if (!c) return <EmptyState icon={Cpu} title={t('pages.noServerSelected')} />;
  if (loadingInfo || loadingHost) return <PageLoader />;

  const instanceData = Array.isArray(info) ? info[0] : info;
  const hostData = Array.isArray(host) ? host[0] : host;
  const versionData = Array.isArray(version) ? version[0] : version;

  const editableFields = [
    { key: 'serverinstance_guest_serverquery_group', label: t('pages.instance.fields.guestServerqueryGroup'), type: 'number' },
    { key: 'serverinstance_template_serveradmin_group', label: t('pages.instance.fields.templateServerAdminGroup'), type: 'number' },
    { key: 'serverinstance_template_serverdefault_group', label: t('pages.instance.fields.templateServerDefaultGroup'), type: 'number' },
    { key: 'serverinstance_template_channeldefault_group', label: t('pages.instance.fields.templateChannelDefaultGroup'), type: 'number' },
    { key: 'serverinstance_template_channeladmin_group', label: t('pages.instance.fields.templateChannelAdminGroup'), type: 'number' },
    { key: 'serverinstance_filetransfer_port', label: t('pages.instance.fields.filetransferPort'), type: 'number' },
    { key: 'serverinstance_serverquery_flood_commands', label: t('pages.instance.fields.floodCommands'), type: 'number' },
    { key: 'serverinstance_serverquery_flood_time', label: t('pages.instance.fields.floodTime'), type: 'number' },
    { key: 'serverinstance_serverquery_ban_time', label: t('pages.instance.fields.floodBanTime'), type: 'number' },
  ];

  // A cleared field parses to NaN, which JSON turns into null and the backend then
  // leaves out - the save would "succeed" without sending anything, so only fields
  // holding a real number count as changes.
  const changes: Record<string, number> = {};
  for (const [k, v] of Object.entries(editFields)) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) changes[k] = n;
  }
  const hasChanges = Object.keys(changes).length > 0;

  const handleSave = () => {
    if (!hasChanges) return;
    editMutation.mutate(changes);
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('nav.items.instance')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Version Card */}
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Server className="h-4 w-4 text-primary" /> {t('pages.instance.version')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow label={t('pages.instance.version')} value={versionData?.version} />
            <InfoRow label={t('pages.instance.build')} value={versionData?.build} />
            <InfoRow label={t('pages.instance.platform')} value={versionData?.platform} />
          </CardContent>
        </Card>

        {/* Host Info Card */}
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Globe className="h-4 w-4 text-primary" /> {t('pages.instance.host')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow label={t('pages.instance.uptime')} value={hostData?.instance_uptime ? formatUptime(hostData.instance_uptime) : '-'} />
            <InfoRow label={t('pages.instance.bytesSent')} value={hostData?.connection_bytes_sent_total ? formatBytes(hostData.connection_bytes_sent_total) : '-'} />
            <InfoRow label={t('pages.instance.bytesReceived')} value={hostData?.connection_bytes_received_total ? formatBytes(hostData.connection_bytes_received_total) : '-'} />
            <InfoRow label={t('nav.items.virtualServers')} value={hostData?.virtualservers_total_maxclients ? `${hostData.virtualservers_total_clients_online || 0} / ${hostData.virtualservers_total_maxclients}` : '-'} />
          </CardContent>
        </Card>

        {/* Database Info Card */}
        <Card className="card-hero">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Cpu className="h-4 w-4 text-primary" /> {t('pages.instance.database')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow label={t('pages.instance.dbPlugin')} value={instanceData?.serverinstance_database_version} />
            <InfoRow label={t('pages.instance.ftPort')} value={instanceData?.serverinstance_filetransfer_port} />
            <InfoRow label={t('pages.instance.permissionsVersion')} value={instanceData?.serverinstance_permissions_version} />
          </CardContent>
        </Card>
      </div>

      {/* Editable Settings */}
      <Card className="card-hero">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">{t('pages.instance.instanceSettings')}</CardTitle>
            <Button size="sm" onClick={handleSave} disabled={!hasChanges || editMutation.isPending}>
              <Save className="h-4 w-4 mr-1" /> {t('pages.instance.saveChanges')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {editableFields.map((field) => {
              const current = instanceData?.[field.key];
              return (
                <div key={field.key}>
                  <Label className="text-xs text-muted-foreground">{field.label}</Label>
                  <Input
                    type="number"
                    className="h-8 mt-1 font-mono-data text-xs"
                    defaultValue={current ?? ''}
                    onChange={(e) => setEditFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* IP Bindings */}
      <Card className="card-hero">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Network className="h-4 w-4 text-primary" /> {t('pages.instance.ipBindings')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(['voice', 'query', 'filetransfer'] as const).map((subsystem) => {
              const list = Array.isArray(bindings?.[subsystem]) ? bindings[subsystem] : bindings?.[subsystem] ? [bindings[subsystem]] : [];
              return (
                <div key={subsystem}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">{t(`pages.instance.subsystem.${subsystem}`)}</p>
                  <div className="space-y-1">
                    {list.length > 0
                      ? list.map((b: any, i: number) => <p key={i} className="text-xs font-mono-data">{b.ip}</p>)
                      : <p className="text-xs text-muted-foreground">-</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono-data font-medium">{value ?? '-'}</span>
    </div>
  );
}
