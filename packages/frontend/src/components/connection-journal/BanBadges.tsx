import { useTranslation } from 'react-i18next';
import type { JournalBanState } from '@ts6/common';
import { Badge } from '@/components/ui/badge';

/** Under an address: whether the web interface turns it away, and whether a TeamSpeak ban covers the client. */
export function BanBadges({ web, ts }: { web: JournalBanState['web']; ts?: boolean | null }) {
  const { t } = useTranslation();
  if (!web && !ts) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {web && (
        <Badge
          variant="destructive"
          data-testid="journal-web-banned"
          title={web.expiresAt ? t('pages.connectionJournal.ban.badge.until', { date: new Date(web.expiresAt).toLocaleString() }) : t('pages.connectionJournal.ban.badge.forever')}
        >
          {t('pages.connectionJournal.ban.badge.web')}
        </Badge>
      )}
      {ts && <Badge variant="destructive" data-testid="journal-ts-banned" title={t('pages.connectionJournal.ban.badge.tsHint')}>{t('pages.connectionJournal.ban.badge.ts')}</Badge>}
    </div>
  );
}
