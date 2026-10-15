import { Link, NavLink, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { ServerSelector } from './ServerSelector';
import { useVisibleNavSections } from './Sidebar';
import { useAuthStore } from '@/stores/auth.store';
import { useLogout } from '@/hooks/use-auth';
import { roleLabel } from '@/lib/roles';
import { settingsTabsFor, resolveSettingsTab } from '@/lib/settings-tabs';

/** Both nav rows scroll sideways on a narrow screen, without showing a scrollbar. */
const NO_SCROLLBAR = 'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * The active tab takes the page's own background and opens into it, like a folder tab;
 * the others sit on the bar.
 */
const tabClass = (active: boolean) => cn(
  'inline-flex h-10 shrink-0 items-center rounded-t-xl px-3.5 text-sm font-medium transition-colors',
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sidebar-accent-foreground',
  active
    ? 'bg-background text-foreground'
    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
);

/**
 * The Lounge design's header, in place of Cockpit's sidebar and header: account row on top,
 * then the sections as tabs, then every page of the active section as plain links.
 */
export function LoungeHeader() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const logout = useLogout();
  const location = useLocation();
  const sections = useVisibleNavSections();
  const [searchParams] = useSearchParams();
  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + '/');
  const activeSection = sections.find((section) => section.items.some((item) => isActive(item.to)));

  // Settings has no section pages of its own; its tabs take that row instead, so it reads
  // like every other section.
  const rowTwo = isActive('/settings')
    ? (() => {
        const isAdmin = user?.role === 'admin';
        const current = resolveSettingsTab(searchParams.get('tab'), isAdmin);
        return settingsTabsFor(isAdmin).map((tab) => ({
          to: `/settings?tab=${tab.value}`,
          label: t(tab.labelKey),
          active: tab.value === current,
        }));
      })()
    : (activeSection?.items ?? []).map((item) => ({ to: item.to, label: item.label, active: isActive(item.to) }));

  return (
    <header className="bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        <Link to="/dashboard" className="flex shrink-0 items-center gap-2.5">
          <img src="/logo-256.png" alt="" className="h-7 w-7 object-contain" />
          <span className="hidden font-display text-[17px] font-semibold text-sidebar-accent-foreground sm:inline">TS6 Manager</span>
        </Link>
        <ServerSelector />

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-accent-foreground text-xs font-bold text-sidebar">
                  {user?.displayName?.[0]?.toUpperCase() ?? '?'}
                </span>
                <span className="hidden text-sm sm:inline">{user?.displayName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{user?.displayName}</p>
                <p className="text-xs text-muted-foreground">{roleLabel(t, user?.role)}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>{t('common.logout')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Row one: the sections. A tab opens the section's first page; a section with a single
          page is named after that page. */}
      <nav className={cn('flex items-end gap-1 px-3 sm:px-5', NO_SCROLLBAR)}>
        {sections.map((section) => (
          <NavLink
            key={section.label}
            to={section.items[0].to}
            className={tabClass(section.items.some((item) => isActive(item.to)))}
          >
            {section.items.length === 1 ? section.items[0].label : section.label}
          </NavLink>
        ))}
        <NavLink to="/settings" className={cn(tabClass(isActive('/settings')), 'ml-auto')}>
          {t('common.settings')}
        </NavLink>
      </nav>

      {/* Row two: every page of the active section, always in view - one click, no menus. */}
      {rowTwo.length > 1 && (
        <nav className={cn('flex gap-x-6 border-b bg-background px-4 sm:px-6', NO_SCROLLBAR)}>
          {rowTwo.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={link.active ? 'page' : undefined}
              className={cn(
                '-mb-px shrink-0 border-b-2 py-2.5 text-sm transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                link.active
                  ? 'border-primary font-semibold text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
