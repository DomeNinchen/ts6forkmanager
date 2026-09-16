import { Link, NavLink, useLocation } from 'react-router';
import {
  LayoutDashboard, Server, Hash, Users, Shield, ShieldCheck,
  Lock, Ban, KeyRound, FolderOpen, MessageSquareWarning, Mail,
  ScrollText, Settings, Bot, Cpu, ChevronLeft, ChevronRight, ChevronDown, Music, ListMusic,
  BarChart3, Wrench, SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';
import { useAuthStore } from '@/stores/auth.store';
import { useServers } from '@/hooks/use-servers';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

interface NavContext {
  isAdmin: boolean;
  canManageBotFlows: boolean;
  canManageMusicBots: boolean;
  /** True for admin (who always has "access"), or a non-admin with at least one assigned server. */
  hasAnyServerAccess: boolean;
}

const adminOnly = (ctx: NavContext) => ctx.isAdmin;

const navSections = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/servers', icon: Server, label: 'Virtual Servers', visible: adminOnly },
      { to: '/server-stats', icon: BarChart3, label: 'Statistics', visible: adminOnly },
    ],
  },
  {
    label: 'Management',
    // Channels/Clients are only meaningful once a server is actually
    // reachable - for a non-admin with zero UserServerAccess grants,
    // showing this section just leads to a guaranteed "no access" page.
    visible: (ctx: NavContext) => ctx.hasAnyServerAccess,
    items: [
      { to: '/channels', icon: Hash, label: 'Channels' },
      { to: '/clients', icon: Users, label: 'Clients' },
      { to: '/server-groups', icon: Shield, label: 'Server Groups', visible: adminOnly },
      { to: '/channel-groups', icon: ShieldCheck, label: 'Channel Groups', visible: adminOnly },
      { to: '/permissions', icon: Lock, label: 'Permissions', visible: adminOnly },
    ],
  },
  {
    label: 'Security',
    visible: adminOnly,
    items: [
      { to: '/bans', icon: Ban, label: 'Bans', visible: adminOnly },
      { to: '/tokens', icon: KeyRound, label: 'Tokens', visible: adminOnly },
    ],
  },
  {
    label: 'Content',
    visible: adminOnly,
    items: [
      { to: '/files', icon: FolderOpen, label: 'Files', visible: adminOnly },
      { to: '/complaints', icon: MessageSquareWarning, label: 'Complaints', visible: adminOnly },
      { to: '/messages', icon: Mail, label: 'Messages', visible: adminOnly },
    ],
  },
  {
    label: 'System',
    visible: adminOnly,
    items: [
      { to: '/logs', icon: ScrollText, label: 'Server Logs', visible: adminOnly },
      { to: '/instance', icon: Cpu, label: 'Instance', visible: adminOnly },
      { to: '/miscellaneous', icon: Wrench, label: 'Miscellaneous', visible: adminOnly },
      { to: '/advanced-settings', icon: SlidersHorizontal, label: 'Advanced Settings', visible: adminOnly },
      { to: '/music-requests', icon: ListMusic, label: 'Music Request History', visible: adminOnly },
    ],
  },
  {
    label: 'Automation',
    visible: (ctx: NavContext) => ctx.canManageBotFlows || ctx.canManageMusicBots,
    items: [
      { to: '/bots', icon: Bot, label: 'Bot Flows', visible: (ctx: NavContext) => ctx.canManageBotFlows },
      { to: '/music-bots', icon: Music, label: 'Music Bots', visible: (ctx: NavContext) => ctx.canManageMusicBots },
    ],
  },
];

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, collapsedSections, toggleSection } = useUiStore();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const canManageBotFlows = useAuthStore((s) => s.canManageBotFlows());
  const canManageMusicBots = useAuthStore((s) => s.canManageMusicBots());
  const { data: servers } = useServers();
  const location = useLocation();

  const navCtx: NavContext = {
    isAdmin,
    canManageBotFlows,
    canManageMusicBots,
    hasAnyServerAccess: isAdmin || (servers?.length ?? 0) > 0,
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out relative',
          sidebarCollapsed ? 'w-16' : 'w-56',
        )}
      >
        {/* Logo area */}
        <div className={cn('flex items-center h-14 px-4 border-b border-sidebar-border', sidebarCollapsed && 'justify-center px-0')}>
          {!sidebarCollapsed ? (
            <Link to="/dashboard" className="flex items-center gap-2.5">
              <img src="/logo-256.png" alt="" className="h-7 w-7 object-contain" />
              <div className="font-display">
                <span className="text-sm font-bold tracking-wide text-sidebar-accent-foreground">TS6</span>
                <span className="text-sm font-semibold tracking-wide text-sidebar-foreground ml-1">Manager</span>
              </div>
            </Link>
          ) : (
            <Link to="/dashboard" className="flex items-center justify-center">
              <img src="/logo-256.png" alt="TS6 Manager" className="h-7 w-7 object-contain" />
            </Link>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-2">
          <nav className="space-y-1 px-2">
            {navSections
              .filter((section) => !(section as any).visible || (section as any).visible(navCtx))
              .map((section, si) => {
                const visibleItems = section.items.filter((item) => !(item as any).visible || (item as any).visible(navCtx));
                if (visibleItems.length === 0) return null;
                const isCollapsed = !sidebarCollapsed && collapsedSections[section.label];
                return (
                  <div key={section.label}>
                    {si > 0 && <Separator className="my-2 bg-sidebar-border" />}
                    {!sidebarCollapsed && (
                      <button
                        onClick={() => toggleSection(section.label)}
                        className="flex items-center justify-between w-full px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors"
                      >
                        <span className="font-display">{section.label}</span>
                        <ChevronDown className={cn('h-3 w-3 transition-transform', isCollapsed && '-rotate-90')} />
                      </button>
                    )}
                    {!isCollapsed && visibleItems.map((item) => {
                      const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
                      const link = (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={cn(
                            'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-all duration-150 border-l-2',
                            sidebarCollapsed && 'justify-center px-0 py-2 border-l-0',
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground border-primary'
                              : 'text-sidebar-foreground border-transparent hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                          )}
                        >
                          <item.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                          {!sidebarCollapsed && <span>{item.label}</span>}
                        </NavLink>
                      );

                      if (sidebarCollapsed) {
                        return (
                          <Tooltip key={item.to}>
                            <TooltipTrigger asChild>{link}</TooltipTrigger>
                            <TooltipContent side="right" className="font-medium">
                              {item.label}
                            </TooltipContent>
                          </Tooltip>
                        );
                      }
                      return link;
                    })}
                  </div>
                );
              })}
          </nav>
        </ScrollArea>

        {/* Settings + Collapse */}
        <div className="border-t border-sidebar-border p-2 space-y-1">
          <NavLink
            to="/settings"
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground border-l-2 border-transparent hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors',
              sidebarCollapsed && 'justify-center px-0 py-2 border-l-0',
              location.pathname.startsWith('/settings') && 'bg-sidebar-accent text-sidebar-accent-foreground border-primary',
            )}
          >
            <Settings className="h-4 w-4" />
            {!sidebarCollapsed && <span>Settings</span>}
          </NavLink>

          <button
            onClick={toggleSidebar}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full',
              sidebarCollapsed && 'justify-center px-0 py-2',
            )}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
