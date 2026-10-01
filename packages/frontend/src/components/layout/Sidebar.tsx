import { Link, NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  LayoutDashboard, Server, Hash, Users, Shield, ShieldCheck,
  Lock, Ban, KeyRound, FolderOpen, Image as ImageIcon, MessageSquareWarning, Mail,
  ScrollText, Settings, Bot, Cpu, ChevronLeft, ChevronRight, ChevronDown, Music, ListMusic,
  BarChart3, Wrench, SlidersHorizontal, Database,
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

function getNavSections(t: TFunction) {
  return [
    {
      label: t('nav.sections.overview'),
      items: [
        { to: '/dashboard', icon: LayoutDashboard, label: t('nav.items.dashboard') },
        { to: '/servers', icon: Server, label: t('nav.items.virtualServers'), visible: adminOnly },
        { to: '/server-stats', icon: BarChart3, label: t('nav.items.statistics'), visible: adminOnly },
      ],
    },
    {
      label: t('nav.sections.management'),
      // Channels/Clients are only meaningful once a server is actually
      // reachable - for a non-admin with zero UserServerAccess grants,
      // showing this section just leads to a guaranteed "no access" page.
      visible: (ctx: NavContext) => ctx.hasAnyServerAccess,
      items: [
        { to: '/channels', icon: Hash, label: t('nav.items.channels') },
        { to: '/clients', icon: Users, label: t('nav.items.clients') },
        { to: '/client-database', icon: Database, label: t('nav.items.clientDatabase'), visible: adminOnly },
        { to: '/server-groups', icon: Shield, label: t('nav.items.serverGroups'), visible: adminOnly },
        { to: '/channel-groups', icon: ShieldCheck, label: t('nav.items.channelGroups'), visible: adminOnly },
        { to: '/permissions', icon: Lock, label: t('nav.items.permissions'), visible: adminOnly },
      ],
    },
    {
      label: t('nav.sections.security'),
      visible: adminOnly,
      items: [
        { to: '/bans', icon: Ban, label: t('nav.items.bans'), visible: adminOnly },
        { to: '/tokens', icon: KeyRound, label: t('nav.items.tokens'), visible: adminOnly },
      ],
    },
    {
      label: t('nav.sections.content'),
      // Unlike the other admin-only sections, this one also has to appear for
      // non-admins, since the icon browser is readable by every role.
      visible: (ctx: NavContext) => ctx.hasAnyServerAccess,
      items: [
        { to: '/files', icon: FolderOpen, label: t('nav.items.files'), visible: adminOnly },
        { to: '/icons', icon: ImageIcon, label: t('nav.items.icons') },
        { to: '/complaints', icon: MessageSquareWarning, label: t('nav.items.complaints'), visible: adminOnly },
        { to: '/messages', icon: Mail, label: t('nav.items.messages'), visible: adminOnly },
      ],
    },
    {
      label: t('nav.sections.system'),
      visible: adminOnly,
      items: [
        { to: '/logs', icon: ScrollText, label: t('nav.items.serverLogs'), visible: adminOnly },
        { to: '/instance', icon: Cpu, label: t('nav.items.instance'), visible: adminOnly },
        { to: '/miscellaneous', icon: Wrench, label: t('nav.items.miscellaneous'), visible: adminOnly },
        { to: '/advanced-settings', icon: SlidersHorizontal, label: t('nav.items.advancedSettings'), visible: adminOnly },
        { to: '/music-requests', icon: ListMusic, label: t('nav.items.musicRequestHistory'), visible: adminOnly },
      ],
    },
    {
      label: t('nav.sections.automation'),
      visible: (ctx: NavContext) => ctx.canManageBotFlows || ctx.canManageMusicBots,
      items: [
        { to: '/bots', icon: Bot, label: t('nav.items.botFlows'), visible: (ctx: NavContext) => ctx.canManageBotFlows },
        { to: '/music-bots', icon: Music, label: t('nav.items.musicBots'), visible: (ctx: NavContext) => ctx.canManageMusicBots },
      ],
    },
  ];
}

export function Sidebar() {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar, collapsedSections, toggleSection } = useUiStore();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const canManageBotFlows = useAuthStore((s) => s.canManageBotFlows());
  const canManageMusicBots = useAuthStore((s) => s.canManageMusicBots());
  const { data: servers } = useServers();
  const location = useLocation();
  const navSections = getNavSections(t);

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
            {!sidebarCollapsed && <span>{t('common.settings')}</span>}
          </NavLink>

          <button
            onClick={toggleSidebar}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full',
              sidebarCollapsed && 'justify-center px-0 py-2',
            )}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!sidebarCollapsed && <span>{t('nav.collapse')}</span>}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
