import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useServers, useVirtualServers } from '@/hooks/use-servers';
import { useServerStore } from '@/stores/server.store';
import { Server } from 'lucide-react';

export function ServerSelector() {
  const { t } = useTranslation();
  const { selectedConfigId, selectedSid, setServer, setSid } = useServerStore();
  const { data: servers } = useServers();
  const { data: virtualServers } = useVirtualServers();

  // Auto-select first server if none selected
  useEffect(() => {
    if (!selectedConfigId && servers?.length > 0) {
      setServer(servers[0].id);
    }
  }, [servers, selectedConfigId, setServer]);

  // Auto-select first virtual server - every other page requires a real
  // selection to function at all, so this always wins even right after an
  // explicit deselect (see VirtualServers.tsx's Select/Deselect toggle).
  // The list only holds the virtual servers this account may use, so a remembered one that is not
  // in it any more (access narrowed to other virtual servers) is replaced the same way.
  useEffect(() => {
    if (!selectedConfigId || !Array.isArray(virtualServers) || virtualServers.length === 0) return;
    if (!selectedSid || !virtualServers.some((v: any) => Number(v.virtualserver_id) === Number(selectedSid))) {
      setSid(virtualServers[0].virtualserver_id);
    }
  }, [virtualServers, selectedConfigId, selectedSid, setSid]);

  return (
    <div className="flex items-center gap-2">
      <Server className="h-4 w-4 text-muted-foreground lounge:hidden lounge:text-sidebar-foreground/70 lounge:sm:block" />
      <Select
        value={selectedConfigId?.toString() || ''}
        onValueChange={(v) => setServer(parseInt(v))}
      >
        <SelectTrigger className="w-[180px] h-8 text-xs lounge:border-sidebar-border lounge:bg-sidebar-accent lounge:text-sm lounge:text-sidebar-foreground">
          <SelectValue placeholder={t('components.serverSelector.selectServer')} />
        </SelectTrigger>
        <SelectContent>
          {servers?.map((s: any) => (
            <SelectItem key={s.id} value={s.id.toString()}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {virtualServers && virtualServers.length > 1 && (
        <>
          <span className="text-muted-foreground text-xs lounge:text-sidebar-foreground/50">/</span>
          <Select
            value={selectedSid?.toString() || ''}
            onValueChange={(v) => setSid(parseInt(v))}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs lounge:border-sidebar-border lounge:bg-sidebar-accent lounge:text-sm lounge:text-sidebar-foreground">
              <SelectValue placeholder={t('components.serverSelector.selectVirtualServer')} />
            </SelectTrigger>
            <SelectContent>
              {virtualServers.map((vs: any) => (
                <SelectItem key={vs.virtualserver_id} value={vs.virtualserver_id.toString()}>
                  {vs.virtualserver_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}
