import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui.store';
import { isDarkBaseTheme } from '@/api/settings.api';
import { baseThemeLabel } from '@/lib/themes';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { baseThemeOverride, installDefaultBaseTheme, lastDarkTheme, lastLightTheme, toggleTheme } = useUiStore();
  const isDark = isDarkBaseTheme(baseThemeOverride ?? installDefaultBaseTheme);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-8 w-8"
      title={t('components.themeToggle.switchTo', { theme: baseThemeLabel(isDark ? lastLightTheme : lastDarkTheme) })}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
