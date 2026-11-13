import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import { useMusicBotState } from '@/hooks/use-music-bots';

/** The red "LIVE" marker for a channel that is live right now (same look as the radio one). */
export function LiveBadge({ pulse = false, className }: { pulse?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="destructive" className={cn('text-[9px] h-4 px-1 shrink-0', pulse && 'animate-pulse', className)}>
      {t('common.live')}
    </Badge>
  );
}

const LIVE_ERROR_KEYS: Record<string, string> = {
  LIVE_DISABLED: 'components.live.errors.disabled',
  LIVE_VIDEO_DISABLED: 'components.live.errors.videoDisabled',
  LIVE_OFFLINE: 'components.live.errors.offline',
};

/** A translated text for the backend's live error codes; null for anything else. */
export function liveErrorText(err: any, t: TFunction): string | null {
  const key = LIVE_ERROR_KEYS[err?.response?.data?.code as string];
  return key ? t(key) : null;
}

/**
 * Shows a live error as a toast: switched-off live streams get a button to Settings -> Streaming for admins.
 * Returns false for any other error, so the caller keeps its own message.
 */
export function useLiveErrorToast() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  return (err: any): boolean => {
    const text = liveErrorText(err, t);
    if (!text) return false;
    const code = err?.response?.data?.code;
    const toSettings = isAdmin && (code === 'LIVE_DISABLED' || code === 'LIVE_VIDEO_DISABLED');
    toast.error(text, toSettings
      ? { action: { label: t('components.live.openSettings'), onClick: () => navigate('/settings?tab=streaming') } }
      : undefined);
    return true;
  };
}

/**
 * Tells whoever has this bot open when its live stream ended for good (offline, time limit, unreachable).
 * Only an end that happens while the page is open counts (compared with the first value seen, so the
 * browser's clock does not matter); the toast id keeps two open views from showing it twice.
 */
export function useLiveEndNotice(botId: number | null) {
  const { t } = useTranslation();
  const { data: state } = useMusicBotState(botId);
  const seen = useRef<{ botId: number | null; at: number | null } | null>(null);
  const end = (state as { lastLiveEnd?: { title: string; code: string; at: number } | null } | undefined)?.lastLiveEnd;
  useEffect(() => {
    if (!state) return;
    const at = end?.at ?? null;
    const first = seen.current?.botId !== botId;
    const changed = !first && at !== seen.current?.at;
    seen.current = { botId, at };
    if (!end || !changed) return;
    toast.info(t(`components.live.ended.${end.code}`, { defaultValue: t('components.live.ended.unreachable') }), {
      id: `live-end-${botId}-${end.at}`,
      description: end.title,
    });
  }, [botId, state, end?.at]); // eslint-disable-line react-hooks/exhaustive-deps
}
