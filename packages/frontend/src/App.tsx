import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { PrivacyNotice } from '@/components/layout/PrivacyNotice';
import { useAuthStore } from '@/stores/auth.store';
import { useLanguageSync } from '@/hooks/use-language';
import { useSelectedServer } from '@/hooks/use-servers';

function AdminRoute({ children }: { children: React.ReactNode }) {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Same idea as AdminRoute, but for the two routes bot-operator/music-operator also need in. */
function RoleRoute({ check, children }: { check: 'botFlows' | 'musicBots'; children: React.ReactNode }) {
  const canManageBotFlows = useAuthStore((s) => s.canManageBotFlows());
  const canManageMusicBots = useAuthStore((s) => s.canManageMusicBots());
  const allowed = check === 'botFlows' ? canManageBotFlows : canManageMusicBots;
  if (!allowed) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * A page that reads or changes the server through WebQuery. On a connection
 * without an API key (only the music bots work on it) there is nothing for it
 * to show - the sidebar already hides it - so a bookmark or the start page
 * sends the visitor to where there is something: the music bots, or the settings.
 */
function WebQueryRoute({ children }: { children: React.ReactNode }) {
  const { hasWebQuery, loaded } = useSelectedServer();
  const canManageMusicBots = useAuthStore((s) => s.canManageMusicBots());
  // The page would ask WebQuery the moment it mounts; whether it may is not known until the server list is here.
  if (!loaded) return <PageLoader />;
  if (!hasWebQuery) return <Navigate to={canManageMusicBots ? '/music-bots' : '/settings'} replace />;
  return <>{children}</>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

// Lazy-loaded pages
const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const VirtualServers = lazy(() => import('@/pages/VirtualServers'));
const ServerStats = lazy(() => import('@/pages/ServerStats'));
const Channels = lazy(() => import('@/pages/Channels'));
const Clients = lazy(() => import('@/pages/Clients'));
const ClientDatabase = lazy(() => import('@/pages/ClientDatabase'));
const ConnectionJournal = lazy(() => import('@/pages/ConnectionJournal'));
const ServerGroups = lazy(() => import('@/pages/ServerGroups'));
const ChannelGroups = lazy(() => import('@/pages/ChannelGroups'));
const Permissions = lazy(() => import('@/pages/Permissions'));
const Bans = lazy(() => import('@/pages/Bans'));
const Tokens = lazy(() => import('@/pages/Tokens'));
const Files = lazy(() => import('@/pages/Files'));
const Icons = lazy(() => import('@/pages/Icons'));
const Complaints = lazy(() => import('@/pages/Complaints'));
const Messages = lazy(() => import('@/pages/Messages'));
const ServerLogs = lazy(() => import('@/pages/ServerLogs'));
const Console = lazy(() => import('@/pages/Console'));
const Instance = lazy(() => import('@/pages/Instance'));
const Miscellaneous = lazy(() => import('@/pages/Miscellaneous'));
const AdvancedServerSettings = lazy(() => import('@/pages/AdvancedServerSettings'));
const BotList = lazy(() => import('@/pages/BotList'));
const BotEditor = lazy(() => import('@/pages/BotEditor'));
const MusicBots = lazy(() => import('@/pages/MusicBots'));
const MusicRequests = lazy(() => import('@/pages/MusicRequests'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const WidgetPage = lazy(() => import('@/pages/WidgetPage'));
const SetupPage = lazy(() => import('@/pages/SetupPage'));
const AuthCallback = lazy(() => import('@/pages/AuthCallback'));

export function App() {
  useLanguageSync();

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/widget/:token" element={<WidgetPage />} />

            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<WebQueryRoute><Dashboard /></WebQueryRoute>} />
              <Route path="/servers" element={<AdminRoute><WebQueryRoute><VirtualServers /></WebQueryRoute></AdminRoute>} />
              <Route path="/server-stats" element={<AdminRoute><WebQueryRoute><ServerStats /></WebQueryRoute></AdminRoute>} />
              <Route path="/channels" element={<WebQueryRoute><Channels /></WebQueryRoute>} />
              <Route path="/clients" element={<WebQueryRoute><Clients /></WebQueryRoute>} />
              <Route path="/client-database" element={<AdminRoute><WebQueryRoute><ClientDatabase /></WebQueryRoute></AdminRoute>} />
              <Route path="/server-groups" element={<AdminRoute><WebQueryRoute><ServerGroups /></WebQueryRoute></AdminRoute>} />
              <Route path="/channel-groups" element={<AdminRoute><WebQueryRoute><ChannelGroups /></WebQueryRoute></AdminRoute>} />
              <Route path="/permissions" element={<AdminRoute><WebQueryRoute><Permissions /></WebQueryRoute></AdminRoute>} />
              <Route path="/bans" element={<AdminRoute><WebQueryRoute><Bans /></WebQueryRoute></AdminRoute>} />
              <Route path="/tokens" element={<AdminRoute><WebQueryRoute><Tokens /></WebQueryRoute></AdminRoute>} />
              <Route path="/connection-journal" element={<AdminRoute><ConnectionJournal /></AdminRoute>} />
              <Route path="/files" element={<AdminRoute><WebQueryRoute><Files /></WebQueryRoute></AdminRoute>} />
              <Route path="/icons" element={<WebQueryRoute><Icons /></WebQueryRoute>} />
              <Route path="/complaints" element={<AdminRoute><WebQueryRoute><Complaints /></WebQueryRoute></AdminRoute>} />
              <Route path="/messages" element={<AdminRoute><WebQueryRoute><Messages /></WebQueryRoute></AdminRoute>} />
              <Route path="/logs" element={<AdminRoute><WebQueryRoute><ServerLogs /></WebQueryRoute></AdminRoute>} />
              <Route path="/console" element={<AdminRoute><WebQueryRoute><Console /></WebQueryRoute></AdminRoute>} />
              <Route path="/instance" element={<AdminRoute><WebQueryRoute><Instance /></WebQueryRoute></AdminRoute>} />
              <Route path="/miscellaneous" element={<AdminRoute><WebQueryRoute><Miscellaneous /></WebQueryRoute></AdminRoute>} />
              <Route path="/advanced-settings" element={<AdminRoute><WebQueryRoute><AdvancedServerSettings /></WebQueryRoute></AdminRoute>} />
              <Route path="/music-requests" element={<AdminRoute><MusicRequests /></AdminRoute>} />
              <Route path="/bots" element={<RoleRoute check="botFlows"><BotList /></RoleRoute>} />
              <Route path="/bots/:botId" element={<RoleRoute check="botFlows"><BotEditor /></RoleRoute>} />
              <Route path="/music-bots" element={<RoleRoute check="musicBots"><MusicBots /></RoleRoute>} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
        <PrivacyNotice />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
