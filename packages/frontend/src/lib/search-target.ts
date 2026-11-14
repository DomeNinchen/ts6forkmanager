import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';

/**
 * Runs `apply` with the value of `?<param>=` once per navigation, as soon as `ready` (the page's
 * data is there). Opening the same target twice from the global search applies it twice.
 */
export function useAddressTarget(param: string, ready: boolean, apply: (value: string) => void) {
  const [params] = useSearchParams();
  const { key } = useLocation();
  const value = params.get(param);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || value === null || done.current === `${key}:${value}`) return;
    done.current = `${key}:${value}`;
    apply(value);
    // `apply` is left out on purpose: it is a fresh closure on every render.
  }, [ready, value, key]);
}

/**
 * Scrolls the element marked `data-search-target="<target>"` into view and outlines it for two
 * seconds. It waits up to three seconds for the element, which may still be loading or behind a tab.
 */
export function revealSearchTarget(target: string) {
  const started = Date.now();
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(`[data-search-target="${CSS.escape(target)}"]`);
    if (!el) {
      if (Date.now() - started < 3000) setTimeout(attempt, 100);
      return;
    }
    el.scrollIntoView({ block: 'center' });
    el.classList.add('search-target-flash');
    setTimeout(() => el.classList.remove('search-target-flash'), 2000);
  };
  attempt();
}
