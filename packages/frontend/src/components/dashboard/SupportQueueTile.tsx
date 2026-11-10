import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Headset } from 'lucide-react';
import type { SupportQueueView } from '@ts6/common';
import { supportQueueApi } from '@/api/support-queue.api';
import { useServerStore } from '@/stores/server.store';
import { formatWait } from '@/pages/Support';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { TileProps } from './tile-types';

const REFRESH_MS = 10_000;

/** Waiting clients, available supporters and the longest wait of one queue (or of all of them together). */
function figures(queues: SupportQueueView[], now: number) {
  const waiting = queues.flatMap((q) => q.cases.filter((k) => k.state === 'waiting'));
  const oldest = waiting.reduce<number | null>((m, k) => Math.min(m ?? Infinity, Date.parse(k.arrivedAt)), null);
  // While a queue is paused nobody knows who is online: no figure rather than a wrong 0.
  const known = queues.every((q) => !q.status.paused);
  // A supporter of several queues counts once.
  const supporters = new Set(queues.flatMap((q) => q.status.supporters.map((p) => p.uid))).size;
  return { waiting: waiting.length, supporters: known ? supporters : null, longestMs: oldest === null ? null : now - oldest };
}

/**
 * The support queues of the selected virtual server. Renders nothing while it has no queue switched on,
 * so nothing changes for servers without one (his choice); the customise mode still lists it.
 */
export function SupportQueueTile({ className }: TileProps) {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const q = useQuery({ queryKey: ['support-queue', c, s], queryFn: () => supportQueueApi.queues(c!, s!), enabled: !!c && !!s, refetchInterval: REFRESH_MS });
  const queues = (q.data ?? []).filter((x) => x.config.enabled);
  if (queues.length === 0) return null;
  const now = Date.now();
  const rows = queues.length > 1 ? queues.map((x) => ({ id: x.config.id!, name: x.config.settings.name, ...figures([x], now) })) : [];
  const all = figures(queues, now);
  const cell = (label: string, value: string | number) => (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono-data text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
  return (
    <Card className={cn('card-hero', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          <Link to="/support" className="flex items-center gap-2 hover:text-foreground">
            <Headset className="h-4 w-4 text-primary" aria-hidden />
            {t('pages.dashboard.supportQueue.title')}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <dl className="grid grid-cols-3 gap-2">
          {cell(t('pages.dashboard.supportQueue.waiting'), all.waiting)}
          {cell(t('pages.dashboard.supportQueue.supporters'), all.supporters ?? '–')}
          {cell(t('pages.dashboard.supportQueue.longest'), all.longestMs === null ? '–' : formatWait(all.longestMs, t))}
        </dl>
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <caption className="sr-only">{t('pages.dashboard.supportQueue.perQueue')}</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="font-normal">{t('pages.dashboard.supportQueue.queue')}</th>
                <th className="pl-2 text-right font-normal">{t('pages.dashboard.supportQueue.waiting')}</th>
                <th className="pl-2 text-right font-normal">{t('pages.dashboard.supportQueue.supporters')}</th>
                <th className="pl-2 text-right font-normal">{t('pages.dashboard.supportQueue.longest')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="max-w-[8rem] truncate py-1"><Link to={`/support?queue=${r.id}`} className="hover:underline">{r.name}</Link></td>
                  <td className="pl-2 text-right tabular-nums">{r.waiting}</td>
                  <td className="pl-2 text-right tabular-nums">{r.supporters ?? '–'}</td>
                  <td className="pl-2 text-right tabular-nums">{r.longestMs === null ? '–' : formatWait(r.longestMs, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
