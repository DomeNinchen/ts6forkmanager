import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui.store';
import { isDarkBaseTheme } from '@/api/settings.api';
import { baseThemeLabel } from '@/lib/themes';

export function ThemeToggle() {
  const { baseThemeOverride, installDefaultBaseTheme, lastDarkTheme, lastLightTheme, toggleTheme } = useUiStore();
  const isDark = isDarkBaseTheme(baseThemeOverride ?? installDefaultBaseTheme);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-8 w-8"
      title={`Switch to ${baseThemeLabel(isDark ? lastLightTheme : lastDarkTheme)}`}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
