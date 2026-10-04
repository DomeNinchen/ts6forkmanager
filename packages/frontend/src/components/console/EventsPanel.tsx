import { useTranslation } from 'react-i18next';
import { Download, Eraser, Play, Square } from 'lucide-react';
import { CONSOLE_EVENT_CATEGORIES, type ConsoleEventCategory } from '@ts6/common';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEntityList } from '@/lib/console/entities';
import { describeFailure } from '@/lib/console/events';
import type { EventConnection, useEventListener } from '@/lib/console/use-event-listener';

interface EventsPanelProps {
  configId: number;
  /** The virtual server the console is on; events belong to one, so 0 (the instance) can not be listened to. */
  sid: number;
  /** Whether the server connection has SSH credentials - live events can not come over WebQuery. */
  sshAvailable: boolean;
  listener: ReturnType<typeof useEventListener>;
  selection: ConsoleEventCategory[];
  onSelectionChange: (next: ConsoleEventCategory[]) => void;
  channelId: string;
  onChannelChange: (id: string) => void;
  /** Start listening to the selection, or switch the running listening over to it. */
  onApply: () => void;
  onStop: () => void;
  onSave: (format: 'txt' | 'json') => void;
}

const BADGE_VARIANT: Record<EventConnection, BadgeProps['variant']> = {
  idle: 'secondary',
  connecting: 'warning',
  live: 'success',
  reconnecting: 'warning',
  closed: 'secondary',
};

/** The categories and the channel the running listening was started with, against what is selected now. */
function sameListening(
  active: { categories: ConsoleEventCategory[]; textChannelId: number | null },
  selection: ConsoleEventCategory[],
  channelId: string,
): boolean {
  if (active.categories.length !== selection.length || !selection.every((category) => active.categories.includes(category))) return false;
  return !selection.includes('textchannel') || active.textChannelId === Number(channelId);
}

export function EventsPanel({
  configId,
  sid,
  sshAvailable,
  listener,
  selection,
  onSelectionChange,
  channelId,
  onChannelChange,
  onApply,
  onStop,
  onSave,
}: EventsPanelProps) {
  const { t } = useTranslation();
  const usable = sshAvailable && sid > 0;
  const running = listener.connection !== 'idle' && listener.connection !== 'closed';
  const changed = running && listener.active !== null && !sameListening(listener.active, selection, channelId);
  const wantsChannel = selection.includes('textchannel');
  const channels = useEntityList('channel', configId, sid, wantsChannel && usable);

  const toggle = (category: ConsoleEventCategory, on: boolean) => {
    const next = on ? [...selection, category] : selection.filter((existing) => existing !== category);
    // In the order the page lists them, whatever order they were ticked in.
    onSelectionChange(CONSOLE_EVENT_CATEGORIES.filter((existing) => next.includes(existing)));
  };

  const { status } = listener;

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{t('pages.console.events.intro')}</p>
      {!sshAvailable && <p className="text-xs text-amber-600 dark:text-amber-400">{t('pages.console.events.noSsh')}</p>}
      {sshAvailable && sid === 0 && <p className="text-xs text-amber-600 dark:text-amber-400">{t('pages.console.events.needVirtualServer')}</p>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CONSOLE_EVENT_CATEGORIES.map((category) => (
          <label key={category} className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 p-2 text-xs">
            <Checkbox
              className="mt-0.5"
              checked={selection.includes(category)}
              disabled={!usable}
              onCheckedChange={(checked) => toggle(category, checked === true)}
            />
            <span>
              <span className="block font-medium">{t(`pages.console.events.categories.${category}.label`)}</span>
              <span className="block text-muted-foreground">{t(`pages.console.events.categories.${category}.help`)}</span>
            </span>
          </label>
        ))}
      </div>

      {wantsChannel && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('pages.console.events.channelLabel')}</span>
          <Select value={channelId} onValueChange={onChannelChange} disabled={!usable}>
            <SelectTrigger className="h-8 w-60 text-xs" aria-label={t('pages.console.events.channelLabel')}>
              <SelectValue placeholder={t('pages.console.events.pickChannel')} />
            </SelectTrigger>
            <SelectContent>
              {(channels.data ?? []).map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.id} {channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!running ? (
          <Button size="sm" onClick={onApply} disabled={!usable || selection.length === 0 || (wantsChannel && !channelId)}>
            <Play className="mr-1 h-3.5 w-3.5" /> {t('pages.console.events.start')}
          </Button>
        ) : (
          <>
            {changed && (
              <Button size="sm" onClick={onApply} disabled={selection.length === 0 || (wantsChannel && !channelId)}>
                <Play className="mr-1 h-3.5 w-3.5" /> {t('pages.console.events.apply')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onStop}>
              <Square className="mr-1 h-3.5 w-3.5" /> {t('pages.console.events.stop')}
            </Button>
          </>
        )}

        <Badge variant={BADGE_VARIANT[listener.connection]}>{t(`pages.console.events.state.${listener.connection}`)}</Badge>
        {listener.active && running && (
          <span className="text-xs text-muted-foreground">
            {t('pages.console.events.listeningTo', { categories: (status?.registered ?? listener.active.categories).join(', ') || '-', sid: listener.active.sid })}
          </span>
        )}
        {status && running && status.textChannelId !== null && (
          <span className="text-xs text-muted-foreground">{t('pages.console.events.hearingChannel', { cid: status.textChannelId })}</span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">{t('pages.console.events.collected', { count: listener.collected })}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={listener.collected === 0}>
                <Download className="mr-1 h-3.5 w-3.5" /> {t('pages.console.events.save')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSave('txt')}>{t('pages.console.events.saveTxt')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSave('json')}>{t('pages.console.events.saveJson')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="sm" onClick={listener.clearCollected} disabled={listener.collected === 0}>
            <Eraser className="mr-1 h-3.5 w-3.5" /> {t('pages.console.events.clearCollected')}
          </Button>
        </div>
      </div>

      {listener.dropped > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">{t('pages.console.events.dropped', { count: listener.dropped })}</p>}
      {status?.refused.map((refusal) => (
        <p key={refusal.category} className="text-xs text-destructive">
          {t('pages.console.events.refused', {
            category: t(`pages.console.events.categories.${refusal.category}.label`),
            message: refusal.message,
            code: refusal.code,
          })}
        </p>
      ))}
      {listener.failure && <p className="text-xs text-destructive">{describeFailure(t, listener.failure)}</p>}
    </div>
  );
}
