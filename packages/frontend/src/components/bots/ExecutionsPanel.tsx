import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Ban, CheckCircle2, CircleSlash, Hourglass, Loader2, X, XCircle } from 'lucide-react';
import { botsApi } from '@/api/bots.api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';

interface Execution {
  id: number;
  triggeredBy: string;
  triggerData: string | null;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'dropped' | 'interrupted' | 'cancelled' | string;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  /** When the Delay a 'waiting' execution sits in ends. */
  resumeAt: string | null;
}

interface ExecutionLog {
  id: number;
  nodeName: string | null;
  level: string;
  message: string;
  timestamp: string;
}

const POLL_MS = 5000;

const STATUS_ICON: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  running: { icon: Loader2, className: 'text-primary animate-spin' },
  waiting: { icon: Hourglass, className: 'text-sky-400' },
  completed: { icon: CheckCircle2, className: 'text-emerald-400' },
  failed: { icon: XCircle, className: 'text-destructive' },
  dropped: { icon: AlertTriangle, className: 'text-amber-400' },
  interrupted: { icon: CircleSlash, className: 'text-orange-400' },
  cancelled: { icon: Ban, className: 'text-muted-foreground' },
};

const LEVEL_VARIANT: Record<string, 'secondary' | 'warning' | 'destructive'> = {
  info: 'secondary',
  warn: 'warning',
  error: 'destructive',
};

function duration(from: string, to: string | null): string | null {
  if (!to) return null;
  const s = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** Number of triggers a 'dropped' row stands for (one row per flow, trigger type and minute). */
function droppedCount(execution: Execution): number {
  try { return Number(JSON.parse(execution.triggerData || '{}').dropped) || 1; } catch { return 1; }
}

/**
 * The flow's last 50 executions and the log of the one picked, as a side panel
 * of the flow editor. Polls while open so running executions move on by themselves.
 */
export function ExecutionsPanel({ botId, onClose }: { botId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: executions, isLoading } = useQuery<Execution[]>({
    queryKey: ['bot-executions', botId],
    queryFn: () => botsApi.executions(botId),
    refetchInterval: POLL_MS,
  });
  const selected = executions?.find((e) => e.id === selectedId) ?? null;

  const { data: logs, isLoading: logsLoading } = useQuery<ExecutionLog[]>({
    queryKey: ['bot-execution-logs', botId, selectedId],
    queryFn: () => botsApi.executionLogs(botId, selectedId!),
    enabled: !!selected && selected.status !== 'dropped',
    refetchInterval: selected?.status === 'running' || selected?.status === 'waiting' ? POLL_MS : false,
  });

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-border bg-card/50">
      <div className="flex items-center justify-between p-3 pb-2">
        <p className="font-display text-xs font-semibold tracking-wide">{t('pages.botEditor.executions.title')}</p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title={t('common.close')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 border-b border-border">
        <div className="space-y-1 p-2 pt-0">
          {isLoading && <LoadingSpinner />}
          {executions?.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">{t('pages.botEditor.executions.empty')}</p>
          )}
          {executions?.map((e) => {
            const { icon: Icon, className } = STATUS_ICON[e.status] ?? STATUS_ICON.completed;
            const took = duration(e.startedAt, e.endedAt);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedId(e.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60',
                  e.id === selectedId && 'bg-muted',
                )}
              >
                <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', className)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {e.status === 'dropped'
                        ? t('pages.botEditor.executions.droppedRow', { count: droppedCount(e), trigger: e.triggeredBy })
                        : `#${e.id} · ${e.triggeredBy}`}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(e.startedAt).toLocaleString()}</span>
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {t(`pages.botEditor.executions.status.${e.status}`, { defaultValue: e.status })}
                    {e.status === 'waiting' && e.resumeAt && ` · ${t('pages.botEditor.executions.waitingUntil', { time: new Date(e.resumeAt).toLocaleTimeString() })}`}
                    {/* Only for these: an interrupted or cancelled row's endedAt can be the next start after a crash, not when it stopped. */}
                    {took && (e.status === 'completed' || e.status === 'failed') && ` · ${took}`}
                  </span>
                  {e.error && (e.status === 'failed' || e.status === 'interrupted' || e.status === 'cancelled') && (
                    <span
                      className={cn('block truncate text-[10px]', e.status === 'failed' ? 'text-destructive' : e.status === 'interrupted' ? 'text-orange-400' : 'text-muted-foreground')}
                      title={e.error}
                    >
                      {e.error}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1.5 p-3">
          {!selected && <p className="text-xs text-muted-foreground">{t('pages.botEditor.executions.pickOne')}</p>}
          {selected?.status === 'dropped' && (
            <p className="text-xs text-muted-foreground">
              {t('pages.botEditor.executions.droppedDetail', { count: droppedCount(selected) })}
            </p>
          )}
          {selected && selected.status !== 'dropped' && (
            <>
              <p className="font-display text-xs font-semibold tracking-wide">
                {t('pages.botEditor.executions.logTitle', { id: selected.id })}
              </p>
              {logsLoading && <LoadingSpinner />}
              {logs?.length === 0 && <p className="text-xs text-muted-foreground">{t('pages.botEditor.executions.noLogs')}</p>}
              {logs?.map((l) => (
                <div key={l.id} className="space-y-0.5 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono-data text-[10px] text-muted-foreground">
                      {new Date(l.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge variant={LEVEL_VARIANT[l.level] ?? 'secondary'} className="px-1 py-0 text-[9px]">{l.level}</Badge>
                    {l.nodeName && <span className="truncate text-muted-foreground">{l.nodeName}</span>}
                  </div>
                  <p className="break-words">{l.message}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
