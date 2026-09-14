import { Outlet, Navigate } from 'react-router';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { UpdateBanner } from './UpdateBanner';
import { YtCookieBanner } from './YtCookieBanner';
import { MandatoryTotpSetup } from './MandatoryTotpSetup';
import { useAuthStore } from '@/stores/auth.store';
import { Toaster } from 'sonner';

export function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const user = useAuthStore((s) => s.user);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const toaster = (
    <Toaster
      position="top-right"
      toastOptions={{
        className: 'bg-popover text-popover-foreground border-border',
      }}
    />
  );

  // Admin accounts must have 2FA enabled - block everything else until they set it up.
  // SSO-authenticated admins are exempt: their login security is delegated to the IdP,
  // which is the right place to enforce MFA for them, not a second, local-only TOTP layer.
  if (user?.role === 'admin' && user.authProvider !== 'oidc' && !user.totpEnabled) {
    return (
      <>
        <MandatoryTotpSetup />
        {toaster}
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <UpdateBanner />
        <YtCookieBanner />
        <Header />
        <main className="flex-1 overflow-auto grid-bg">
          <div className="p-5 fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      {toaster}
    </div>
  );
}
