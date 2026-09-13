import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/auth.store';
import { authApi } from '@/api/auth.api';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { useRecheckUpdate } from '@/hooks/use-update-check';

/**
 * Landing point after a successful OIDC redirect back from the backend (see
 * oidc-auth.routes.ts). Tokens travel in the URL fragment (#), not the query
 * string, so they're never sent to a server or logged - only ever read here,
 * client-side, then discarded from the address bar.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const ran = useRef(false);
  const recheckUpdate = useRecheckUpdate();

  useEffect(() => {
    if (ran.current) return; // React 18 StrictMode double-invokes effects in dev - tokens are single-use-ish (a fresh pair), running twice would just be wasteful, not unsafe, but skip it anyway
    ran.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    // Clear the fragment immediately regardless of outcome - don't leave tokens sitting in the address bar / history longer than necessary
    window.history.replaceState(null, '', window.location.pathname);

    if (!accessToken || !refreshToken) {
      navigate('/login?error=sso_failed', { replace: true });
      return;
    }

    const { setTokens, setAuth, logout } = useAuthStore.getState();
    setTokens(accessToken, refreshToken);

    authApi.me()
      .then(({ user }) => {
        setAuth(accessToken, refreshToken, user);
        recheckUpdate.mutate(); // same as the local-login path - fresh check right on login, not whatever's cached
        navigate('/dashboard', { replace: true });
      })
      .catch(() => {
        logout();
        navigate('/login?error=sso_failed', { replace: true });
      });
  }, [navigate]);

  return <PageLoader />;
}
