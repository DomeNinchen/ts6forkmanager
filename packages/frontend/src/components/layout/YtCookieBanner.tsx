import { AlertTriangle, X } from 'lucide-react';
import { useYtCookieCheck } from '@/hooks/use-yt-cookie-check';
import { useYtCookieBannerStore } from '@/stores/yt-cookie-banner.store';

export function YtCookieBanner() {
  const { data } = useYtCookieCheck();
  const dismissedFor = useYtCookieBannerStore((s) => s.dismissedFor);
  const dismiss = useYtCookieBannerStore((s) => s.dismiss);

  // valid === null means no cookie file is configured at all - not a problem
  // to flag, the feature just isn't in use. Only a configured-but-broken
  // file (valid === false) is worth interrupting anyone about.
  if (!data || data.valid !== false || !data.checkedAt) return null;
  if (dismissedFor === data.checkedAt) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-destructive/10 px-4 py-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span>
          YouTube cookies stopped working — age-restricted/member-only content and searches may fail until they're refreshed in{' '}
          <span className="font-mono-data">Settings → YouTube</span>.
        </span>
      </div>
      <button onClick={() => dismiss(data.checkedAt!)} className="p-1 hover:bg-muted rounded-sm shrink-0" title="Postpone">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
