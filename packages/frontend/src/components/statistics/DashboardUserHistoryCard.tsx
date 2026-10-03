import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LineChart } from 'lucide-react';
import { useDashboardUserHistory } from '@/hooks/use-dashboard';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { UserHistoryChart } from '@/components/statistics/UserHistoryChart';
import { readStoredTimeZone } from '@/lib/user-history-time';

/**
 * The dashboard's view of the recorded user count: the last 24 hours, drawn
 * exactly like the Statistics -> History tab (weekends, 24-hour average,
 * unreachable and stopped periods) but without the legend and the controls.
 *
 * Visible to every role with access to the server, like the rest of the
 * dashboard. Only admins get the link on to the full tab, which they alone can
 * open; the longer windows and the recording settings live there.
 */
export function DashboardUserHistoryCard() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data, isLoading, isError } = useDashboardUserHistory();
  // The clock the viewer chose on the History tab; the card has no switch of its own.
  const tz = useMemo(readStoredTimeZone, []);

  const peak = data?.stats.peak ?? null;
  const average = data?.stats.average ?? null;

  let body: React.ReactNode;
  if (isLoading) {
    body = <LoadingSpinner className="py-8" />;
  } else if (isError || !data) {
    body = <p className="py-8 text-center text-sm text-muted-foreground">{t('pages.dashboard.userHistory.loadFailed')}</p>;
  } else if (data.firstSampleAt === null) {
    body = (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {data.recording ? t('pages.dashboard.userHistory.noData') : t('pages.dashboard.userHistory.recordingOff')}
      </p>
    );
  } else {
    body = (
      <>
        <UserHistoryChart data={data} tz={tz} compact />
        {!data.recording && (
          <p className="mt-2 text-[11px] text-muted-foreground">{t('pages.dashboard.userHistory.recordingOffNote')}</p>
        )}
      </>
    );
  }

  return (
    <Card className="card-hero">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-muted-foreground">
          <span className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-primary" />
            {t('pages.dashboard.userHistory.title')}
          </span>
          <span className="ml-auto flex items-center gap-4 text-[11px] font-normal">
            {peak && <span className="font-mono-data">{t('pages.dashboard.userHistory.peak', { value: peak.users })}</span>}
            {average !== null && (
              <span className="font-mono-data">{t('pages.dashboard.userHistory.average', { value: average.toFixed(1) })}</span>
            )}
            {isAdmin && (
              <Link to="/server-stats?tab=history" className="text-primary hover:underline">
                {t('pages.dashboard.userHistory.moreInHistory')}
              </Link>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
