import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Bot } from 'lucide-react';
import { useBots } from '@/hooks/use-bots';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TileProps } from './tile-types';

interface DashboardBotFlow {
  id: number;
  name: string;
  enabled: boolean;
}

/** Visible to everyone (view-only awareness of what's automated on this server); only clickable
    through to the editor for a user who actually has bot-flow permissions - the editor route
    itself redirects anyone else straight back here, which would otherwise look like a dead click. */
function BotFlowRow({ flow, canEdit, t }: { flow: DashboardBotFlow; canEdit: boolean; t: TFunction }) {
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
        {flow.enabled ? t('common.active') : t('common.inactive')}
      </Badge>
    </div>
  );
  return canEdit ? <Link to={`/bots/${flow.id}`}>{inner}</Link> : inner;
}

/** Renders nothing when the selected server has no flows - the tile only exists where there is something to show. */
export function BotFlowsTile({ className }: TileProps) {
  const { t } = useTranslation();
  const { selectedConfigId, selectedSid } = useServerStore();
  const canManageBotFlows = useAuthStore((s) => s.canManageBotFlows());
  const { data: allBots } = useBots();
  const serverBotFlows = (allBots ?? []).filter(
    (b: any) => b.serverConfigId === selectedConfigId && String(b.virtualServerId) === String(selectedSid),
  );
  if (serverBotFlows.length === 0) return null;
  return (
    <Card className={cn('card-hero', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          {t('pages.dashboard.botFlows')}
          <span className="font-mono-data text-[11px] text-muted-foreground/70 font-normal">({serverBotFlows.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {serverBotFlows.map((flow: DashboardBotFlow) => (
          <BotFlowRow key={flow.id} flow={flow} canEdit={canManageBotFlows} t={t} />
        ))}
      </CardContent>
    </Card>
  );
}
