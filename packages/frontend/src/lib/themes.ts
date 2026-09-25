import { DARK_BASE_THEMES, LIGHT_BASE_THEMES, type AccentPreset, type BaseTheme } from '@/api/settings.api';

/** Swatch colours are the dark-mode values of each accent - the recognisable form of the hue. */
export const ACCENT_PRESETS: { value: AccentPreset; label: string; swatch: string }[] = [
  { value: 'violet', label: 'Violet', swatch: 'hsl(252 100% 68%)' },
  { value: 'teal', label: 'Teal', swatch: 'hsl(186 72% 42%)' },
  { value: 'red', label: 'Red', swatch: 'hsl(355 75% 50%)' },
  { value: 'blue', label: 'Blue', swatch: 'hsl(217 75% 52%)' },
  { value: 'yellow', label: 'Yellow', swatch: 'hsl(42 88% 50%)' },
  { value: 'green', label: 'Green', swatch: 'hsl(142 65% 40%)' },
  { value: 'orange', label: 'Orange', swatch: 'hsl(25 92% 53%)' },
  { value: 'pink', label: 'Pink', swatch: 'hsl(330 80% 54%)' },
  { value: 'cyan', label: 'Cyan', swatch: 'hsl(190 90% 48%)' },
  { value: 'lime', label: 'Lime', swatch: 'hsl(85 68% 45%)' },
];

/** Preview colours are each theme's own --background. */
export const BASE_THEME_PRESETS: { value: BaseTheme; label: string; description: string; preview: string }[] = [
  { value: 'command-deck', label: 'Command Deck', description: 'Deep navy - the default look.', preview: 'hsl(225 38% 6%)' },
  { value: 'oled', label: 'OLED-Black', description: 'True black background - saves power on OLED screens.', preview: 'hsl(0 0% 0%)' },
  { value: 'graphite', label: 'Graphite', description: 'Neutral grey with no colour cast.', preview: 'hsl(0 0% 9%)' },
  { value: 'carbon', label: 'Carbon', description: 'Warm anthracite with a faint brown cast.', preview: 'hsl(20 10% 8%)' },
  { value: 'frost', label: 'Frost', description: 'Cool blue-grey, lower contrast.', preview: 'hsl(220 17% 13%)' },
  { value: 'deep-forest', label: 'Deep Forest', description: 'Dark green-black.', preview: 'hsl(155 28% 6%)' },
  { value: 'daylight', label: 'Daylight', description: 'Neutral light grey and white.', preview: 'hsl(210 20% 98%)' },
  { value: 'paper', label: 'Paper', description: 'Warm off-white with a light sepia cast.', preview: 'hsl(40 30% 95%)' },
  { value: 'frost-light', label: 'Frost Light', description: 'Cool light blue-grey.', preview: 'hsl(218 27% 94%)' },
];

export const DARK_THEME_PRESETS = BASE_THEME_PRESETS.filter((t) =>
  (DARK_BASE_THEMES as readonly string[]).includes(t.value));
export const LIGHT_THEME_PRESETS = BASE_THEME_PRESETS.filter((t) =>
  (LIGHT_BASE_THEMES as readonly string[]).includes(t.value));

export function baseThemeLabel(theme: BaseTheme): string {
  return BASE_THEME_PRESETS.find((t) => t.value === theme)?.label ?? theme;
}

export function accentLabel(preset: AccentPreset): string {
  return ACCENT_PRESETS.find((p) => p.value === preset)?.label ?? preset;
}
