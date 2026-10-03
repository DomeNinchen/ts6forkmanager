import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, RefreshCw, ScrollText } from 'lucide-react';
import type { ConsoleAuditEntry, ConsoleAuditStatus } from '@ts6/common';
import { consoleApi } from '@/api/console.api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';

interface AuditLogPanelProps {
  configId: number;
}

function StatusBadge({ entry }: { entry: ConsoleAuditEntry }) {
  const { t } = useTranslation();
  if (entry.status === 'ok') return <Badge variant="success">{t('pages.console.log.ok')}</Badge>;
  if (entry.status === 'pending') return <Badge variant="warning" title={t('pages.console.log.pendingHint')}>{t('pages.console.log.pending')}</Badge>;
  return (
    <Badge variant="destructive" title={entry.errorMessage ?? undefined}>
      {t('pages.console.log.error')}
      {entry.errorCode !== null && ` ${entry.errorCode}`}
    </Badge>
  );
}

/** Who ran what, where and when - every command the console sent to TeamSpeak, newest first. */
export function AuditLogPanel({ configId }: AuditLogPanelProps) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ConsoleAuditStatus>('all');
  const [dangerOnly, setDangerOnly] = useState(false);
  const [thisServer, setThisServer] = useState(true);

  // Search as the admin types, but not once per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = useInfiniteQuery({
    queryKey: ['console-log', configId, search, status, dangerOnly, thisServer],
    queryFn: ({ pageParam }) =>
      consoleApi.log(configId, {
        before: pageParam,
        limit: 50,
        search,
        status: status === 'all' ? undefined : status,
        dangerOnly,
        thisServer,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });

  const entries = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-3">
      <Card className="card-hero">
        <CardContent className="flex flex-wrap items-end gap-4 pt-5">
          <div className="min-w-48 flex-1">
            <Label className="text-xs">{t('pages.console.log.search')}</Label>
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('pages.console.log.searchPlaceholder')}
              className="mt-1 h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">{t('common.status')}</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as 'all' | ConsoleAuditStatus)}>
              <SelectTrigger className="mt-1 h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('pages.console.log.allStatuses')}</SelectItem>
                <SelectItem value="ok">{t('pages.console.log.ok')}</SelectItem>
                <SelectItem value="error">{t('pages.console.log.error')}</SelectItem>
                <SelectItem value="pending">{t('pages.console.log.pending')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={dangerOnly} onCheckedChange={setDangerOnly} />
            {t('pages.console.log.dangerOnly')}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={thisServer} onCheckedChange={setThisServer} />
            {t('pages.console.log.thisServerOnly')}
          </label>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={query.isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            {t('common.refresh')}
          </Button>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <PageLoader />
      ) : entries.length === 0 ? (
        <EmptyState icon={ScrollText} title={t('pages.console.log.empty')} description={t('pages.console.log.emptyHint')} />
      ) : (
        <Card className="card-hero">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/50 text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t('pages.console.log.time')}</th>
                  <th className="px-3 py-2 font-medium">{t('common.username')}</th>
                  <th className="px-3 py-2 font-medium">{t('pages.console.log.where')}</th>
                  <th className="px-3 py-2 font-medium">{t('pages.console.log.command')}</th>
                  <th className="px-3 py-2 font-medium">{t('pages.console.log.result')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('pages.console.log.duration')}</th>
                  <th className="px-3 py-2 font-medium" title={t('pages.console.log.teamSpeakLogHint')}>
                    {t('pages.console.log.teamSpeakLog')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-border/60 align-top hover:bg-muted/20">
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{entry.username}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {entry.serverName}{' '}
                      <span className="text-muted-foreground">
                        {entry.virtualServerId === 0 ? t('pages.console.log.instance') : `#${entry.virtualServerId}`}
                      </span>
                    </td>
                    <td className="max-w-[34rem] px-3 py-1.5 font-mono">
                      <div className="flex items-center gap-1.5">
                        {entry.danger && <Badge variant="destructive">{t('pages.console.log.danger')}</Badge>}
                        <span className="truncate" title={entry.command}>
                          {entry.command}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <StatusBadge entry={entry} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-muted-foreground">
                      {entry.durationMs !== null ? `${entry.durationMs} ms` : '–'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {entry.loggedToTeamSpeak ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : entry.mutating ? '–' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {query.hasNextPage && (
              <div className="border-t border-border p-2 text-center">
                <Button variant="ghost" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                  {query.isFetchingNextPage ? t('common.loading') : t('pages.console.log.loadMore')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
