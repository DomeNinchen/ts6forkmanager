import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { settingsApi, type ClientIpDiagnostics } from '@/api/settings.api';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type ChainEntry = ClientIpDiagnostics['chain'][number];

/**
 * Settings -> Network: which address the backend takes for the person looking at this
 * page, how that address was worked out, and what TRUST_PROXY would have to be for it to
 * be the right one. The backend cannot know how many proxies stand in front of it, so
 * the admin checks it here against an address they know is theirs.
 */
export function NetworkTab() {
  const { t } = useTranslation();
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['client-ip'],
    queryFn: settingsApi.getClientIp,
    // The answer is about this very request, not something that goes stale in a useful way.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <PageLoader />;
  if (isError || !data) {
    return (
      <div className="max-w-2xl">
        <p className="text-sm text-destructive">{t('pages.settings.network.loadFailed')}</p>
      </div>
    );
  }

  const clientIndex = Math.max(0, data.chain.findIndex((entry) => entry.address === data.ip));
  const suggestion = data.suggestedHops;
  const suggestionMatches = suggestion !== null && suggestion === clientIndex;
  const suggestedAddress = suggestion !== null ? data.chain[suggestion]?.address : undefined;

  const entryRole = (index: number): 'proxy' | 'client' | 'ignored' =>
    index < clientIndex ? 'proxy' : index === clientIndex ? 'client' : 'ignored';

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="card-hero">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">{t('pages.settings.network.title')}</CardTitle>
          <Button size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', isFetching && 'animate-spin')} />
            {t('pages.settings.network.checkAgain')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{t('pages.settings.network.description')}</p>

          <div className="rounded-md border p-3 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('pages.settings.network.detectedLabel')}</p>
            <p className="font-mono-data text-lg" data-testid="detected-ip">{data.ip || '–'}</p>
            <p className="text-xs text-muted-foreground">{t('pages.settings.network.detectedHint')}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs">
              <span className="text-muted-foreground">{t('pages.settings.network.settingLabel')}: </span>
              <code className="font-mono-data">TRUST_PROXY={data.trustProxy.envValue}</code>{' '}
              <span className="text-muted-foreground">
                ({data.trustProxy.fromEnv ? t('pages.settings.network.settingFromEnv') : t('pages.settings.network.settingDefault')} – {data.trustProxy.description})
              </span>
            </p>
            {data.trustProxy.warning && (
              <p className="text-xs text-amber-500" data-testid="trust-proxy-warning">{data.trustProxy.warning}</p>
            )}
          </div>

          {suggestion === null ? (
            <p className="text-xs text-muted-foreground" data-testid="suggestion-none">{t('pages.settings.network.suggestionNone')}</p>
          ) : suggestionMatches ? (
            <p className="text-xs text-emerald-500" data-testid="suggestion-match">
              {t('pages.settings.network.suggestionMatches', { count: suggestion })}
            </p>
          ) : (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-1" data-testid="suggestion-differs">
              <p className="text-xs">
                {t('pages.settings.network.suggestionDiffers', { hops: suggestion, address: suggestedAddress })}
              </p>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.network.suggestionCheck')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.network.chainTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{t('pages.settings.network.chainHint')}</p>
          <ol className="space-y-1.5">
            {data.chain.map((entry: ChainEntry, index: number) => {
              const role = entryRole(index);
              return (
                <li
                  key={`${index}-${entry.address}`}
                  className={cn('flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5', role === 'client' && 'border-primary/50 bg-primary/5')}
                >
                  <span className="font-mono-data text-sm">{entry.address}</span>
                  <Badge variant="outline">{t(`pages.settings.network.origin.${entry.origin}`)}</Badge>
                  <Badge variant="secondary">{t(`pages.settings.network.scope.${entry.scope}`)}</Badge>
                  {role === 'proxy' && <Badge variant="success">{t('pages.settings.network.role.proxy')}</Badge>}
                  {role === 'client' && <Badge>{t('pages.settings.network.role.client')}</Badge>}
                  {role === 'ignored' && <Badge variant="warning">{t('pages.settings.network.role.ignored')}</Badge>}
                </li>
              );
            })}
          </ol>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">X-Forwarded-For</dt>
            <dd className="font-mono-data break-all">{data.forwardedFor ?? t('pages.settings.network.notSent')}</dd>
            <dt className="text-muted-foreground">X-Real-IP</dt>
            <dd className="font-mono-data break-all">{data.realIp ?? t('pages.settings.network.notSent')}</dd>
          </dl>

          <p className="text-[11px] text-muted-foreground">{t('pages.settings.network.howToChange')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
