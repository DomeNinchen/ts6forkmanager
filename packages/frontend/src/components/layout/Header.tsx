import { LogOut, Menu, User } from 'lucide-react';
import { useUiStore } from '@/stores/ui.store';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { ServerSelector } from './ServerSelector';
import { useAuthStore } from '@/stores/auth.store';
import { useLogout } from '@/hooks/use-auth';
import { roleLabel } from '@/lib/roles';

export function Header() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const logout = useLogout();
  const { mobileNavOpen, setMobileNavOpen } = useUiStore();

  return (
    <header className="flex items-center justify-between gap-2 h-14 px-3 md:px-5 border-b border-border bg-card/50 backdrop-blur-xs">
      <div className="flex min-w-0 items-center gap-2">
        {/* Below md the sidebar is a drawer (see Sidebar), opened from here. */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 md:hidden"
          aria-label={t('nav.openMenu')}
          aria-expanded={mobileNavOpen}
          data-mobile-nav-trigger
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </Button>
        <ServerSelector />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 h-8">
              <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center">
                <User className="h-3 w-3 text-primary" />
              </div>
              <span className="hidden text-xs sm:inline">{user?.displayName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user?.displayName}</p>
              <p className="text-xs text-muted-foreground">{roleLabel(t, user?.role, user?.roleName)}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              <span>{t('common.logout')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
