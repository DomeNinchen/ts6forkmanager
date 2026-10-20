import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { backendAnswers, useRestartStore } from '@/stores/restart.store';

const POLL_MS = 2000;

/**
 * Whether the page this tab runs is still the one the server hands out: 'changed' after an
 * update rebuilt the frontend (its index.html names other script files), 'down' while the
 * page itself cannot be fetched yet.
 */
async function frontendState(): Promise<'same' | 'changed' | 'down'> {
  const src = document.querySelector('script[type="module"][src]')?.getAttribute('src');
  try {
    const res = await fetch('/', { cache: 'no-store' });
    if (!res.ok) return 'down';
    return src && (await res.text()).includes(src) ? 'same' : 'changed';
  } catch {
    return 'down';
  }
}

/**
 * Covers the page while the manager does not answer - mostly the few seconds in which an
 * update or a restart replaces the containers - and carries on by itself afterwards: a
 * reload when the update brought a new frontend, otherwise only fresh data, so nothing
 * typed into the page is lost.
 */
export function RestartNotice() {
  const { pathname } = useLocation();
  const down = useRestartStore((s) => s.down);
  // The widget is an iframe on someone else's page; it retries by itself.
  if (!down || pathname.startsWith('/widget/')) return null;
  return <RestartOverlay />;
}

function RestartOverlay() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const state = (await backendAnswers()) ? await frontendState() : 'down';
      if (!active) return;
      if (state === 'changed') return window.location.reload();
      if (state === 'same') {
        useRestartStore.setState({ down: false });
        void qc.invalidateQueries();
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [qc]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div role="status" aria-live="polite" className="flex max-w-sm items-start gap-3 rounded-md border border-border bg-card p-4 text-card-foreground shadow-lg">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('components.restartNotice.title')}</p>
          <p className="text-xs text-muted-foreground">{t('components.restartNotice.message')}</p>
        </div>
      </div>
    </div>
  );
}
