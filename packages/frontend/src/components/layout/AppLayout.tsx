import { Outlet, Navigate } from 'react-router';
import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { LoungeHeader } from './LoungeHeader';
import { UpdateBanner } from './UpdateBanner';
import { YtCookieBanner } from './YtCookieBanner';
import { useAuthStore } from '@/stores/auth.store';
import { useOwnRoleSync } from '@/hooks/use-auth';
import { useWebguiThemeSync, useWebguiBaseThemeSync, useWebguiDesignSync, useDesign } from '@/hooks/use-webgui-theme';
import { Toaster } from 'sonner';
import { BulkResultDialog } from '@/components/shared/BulkResultDialog';

export function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const lounge = useDesign() === 'lounge';
  useWebguiThemeSync();
  useWebguiBaseThemeSync();
  useWebguiDesignSync();
  useOwnRoleSync();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Both designs share this tree; only the sidebar and the header swap, so switching the
  // design in Settings keeps the page underneath (and its open tab) mounted.
  return (
    <div className="flex h-screen overflow-hidden">
      {!lounge && <Sidebar />}
      <div className="flex flex-1 flex-col overflow-hidden">
        <UpdateBanner />
        <YtCookieBanner />
        {lounge ? <LoungeHeader /> : <Header />}
        <main className={cn('flex-1 overflow-auto', !lounge && 'grid-bg')}>
          <div className={lounge ? 'max-w-[1600px] px-4 py-6 sm:px-6' : 'p-5 fade-in'}>
            <Outlet />
          </div>
        </main>
      </div>
      <BulkResultDialog />
      <Toaster
        position="top-right"
        toastOptions={{
          className: 'bg-popover text-popover-foreground border-border',
        }}
      />
    </div>
  );
}
