import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Filter, ShieldOff } from 'lucide-react';
import type { WebIpBanDto } from '@ts6/common';
import { connectionJournalApi } from '@/api/connection-journal.api';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { CountryCell } from './CountryCell';

/** The addresses the web interface turns away, how often each did, and lifting them. Bans on a TeamSpeak server are lifted on the Bans page. */
export function BansTab({ onFilterIp }: { onFilterIp: (ip: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [lifting, setLifting] = useState<WebIpBanDto | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['connection-journal', 'bans'],
    queryFn: connectionJournalApi.bans,
    // The counters move while somebody keeps knocking.
    refetchInterval: 15_000,
  });

  const lift = useMutation({
    mutationFn: (id: number) => connectionJournalApi.removeWebBan(id),
    onSuccess: () => {
      toast.success(t('pages.connectionJournal.bans.lifted', { ip: lifting?.ip ?? '' }));
      setLifting(null);
      void qc.invalidateQueries({ queryKey: ['connection-journal'] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('pages.connectionJournal.bans.liftFailed')),
  });

  if (isLoading) return <PageLoader />;
  if (isError || !data) return <p className="text-sm text-destructive">{t('pages.connectionJournal.loadFailed')}</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t('pages.connectionJournal.bans.description')}{' '}
        <Link to="/bans" className="underline hover:text-foreground">{t('pages.connectionJournal.bans.tsBansLink')}</Link>
      </p>
      {data.disabled && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-400" data-testid="bans-disabled">
          {t('pages.connectionJournal.ban.disabled')}
        </p>
      )}

      <div className="card-hero rounded-md border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {['address', 'country', 'reason', 'setBy', 'setAt', 'ends', 'turnedAway'].map((column) => (
                <th key={column} className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">{t(`pages.connectionJournal.bans.columns.${column}`)}</th>
              ))}
              <th className="h-10 px-3" />
            </tr>
          </thead>
          <tbody>
            {data.bans.length === 0 ? (
              <tr>
                <td colSpan={8} className="h-24 text-center text-muted-foreground" data-testid="bans-empty">{t('pages.connectionJournal.bans.empty')}</td>
              </tr>
            ) : (
              data.bans.map((ban) => (
                <tr key={ban.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors" data-testid="ban-row">
                  <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-mono-data hover:text-primary transition-colors"
                      title={t('pages.connectionJournal.filterByAddress')}
                      onClick={() => onFilterIp(ban.ip)}
                    >
                      {ban.ip}
                      <Filter className="h-3 w-3 opacity-40" />
                    </button>
                  </td>
                  <td className="px-3 py-2.5 align-middle text-xs">
                    <CountryCell country={ban.geo?.country ?? null} region={ban.geo?.region ?? null} city={ban.geo?.city ?? null} scope={ban.scope} />
                  </td>
                  <td className="px-3 py-2.5 align-middle text-xs max-w-[240px] break-words">{ban.reason ?? <span className="text-muted-foreground">–</span>}</td>
                  <td className="px-3 py-2.5 align-middle text-xs">{ban.createdBy}</td>
                  <td className="px-3 py-2.5 align-middle whitespace-nowrap font-mono-data text-xs">{new Date(ban.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2.5 align-middle whitespace-nowrap font-mono-data text-xs">
                    {ban.expiresAt ? new Date(ban.expiresAt).toLocaleString() : t('common.duration.permanent')}
                  </td>
                  <td className="px-3 py-2.5 align-middle text-xs">
                    <div className="font-mono-data">{ban.blockedCount}</div>
                    {ban.lastBlockedAt && (
                      <div className="text-muted-foreground">{t('pages.connectionJournal.bans.lastBlocked', { date: new Date(ban.lastBlockedAt).toLocaleString() })}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-middle text-right">
                    <Button size="sm" variant="outline" onClick={() => setLifting(ban)} data-testid="ban-lift">
                      <ShieldOff className="h-3.5 w-3.5 mr-1" /> {t('pages.connectionJournal.bans.lift')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={lifting !== null}
        onOpenChange={(open) => { if (!open) setLifting(null); }}
        title={t('pages.connectionJournal.bans.liftTitle', { ip: lifting?.ip ?? '' })}
        description={t('pages.connectionJournal.bans.liftDescription')}
        confirmLabel={t('pages.connectionJournal.bans.lift')}
        loading={lift.isPending}
        onConfirm={() => lifting && lift.mutate(lifting.id)}
      />
    </div>
  );
}
