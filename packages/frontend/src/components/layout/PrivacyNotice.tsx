import { Info } from 'lucide-react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { usePublicConfig } from '@/hooks/use-public-config';
import { usePrivacyNoticeStore } from '@/stores/privacy-notice.store';

/**
 * Informational note about what this app keeps in the browser. Not a consent gate:
 * the app only stores technically necessary data (login, language, display state), so
 * there is nothing to accept or decline and nothing waits for the click - the button
 * only hides the note for good in this browser. An admin can switch it off for
 * everyone under Settings -> WebGui; the setting is readable without a login, which
 * is why it also shows on the login page.
 */
export function PrivacyNotice() {
  const { pathname } = useLocation();

  // The widget page is an iframe on someone else's site - what that site tells its own
  // visitors is the embedding operator's business, and the widget page stores nothing.
  // Checked out here so that page doesn't even fetch the setting.
  if (pathname.startsWith('/widget/')) return null;
  return <PrivacyNoticeBar />;
}

function PrivacyNoticeBar() {
  const { t } = useTranslation();
  const { data } = usePublicConfig();
  const dismissed = usePrivacyNoticeStore((s) => s.dismissed);
  const dismiss = usePrivacyNoticeStore((s) => s.dismiss);

  if (!data?.privacyNotice.enabled || dismissed) return null;

  return (
    <div
      role="region"
      aria-label={t('components.privacyNotice.title')}
      className="fixed bottom-4 left-4 right-4 z-40 rounded-md border border-border bg-card p-3 text-xs text-card-foreground shadow-lg sm:left-auto sm:max-w-md"
    >
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="space-y-2">
          <p className="font-medium">{t('components.privacyNotice.title')}</p>
          <p className="text-muted-foreground">{t('components.privacyNotice.message')}</p>
          <Button size="sm" className="h-7 text-xs" onClick={dismiss}>
            {t('components.privacyNotice.dismiss')}
          </Button>
        </div>
      </div>
    </div>
  );
}
