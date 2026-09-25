import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isDarkBaseTheme, type AccentPreset, type BaseTheme } from '@/api/settings.api';

function applyAccent(preset: AccentPreset) {
  document.documentElement.dataset.accent = preset;
}

/** The base theme is what decides light vs. dark, so the `.dark` class follows from it. */
function applyBaseTheme(theme: BaseTheme) {
  document.documentElement.dataset.baseTheme = theme;
  document.documentElement.classList.toggle('dark', isDarkBaseTheme(theme));
}

interface UiStore {
  sidebarCollapsed: boolean;
  /** Which sidebar nav section labels (e.g. "Management") are collapsed - independent of the whole-sidebar collapse above. */
  collapsedSections: Record<string, boolean>;
  /** This user's personal choice, overriding the installation default below. null = follow the installation default. */
  accentOverride: AccentPreset | null;
  /** The admin-set installation-wide default (Settings → WebGui) - fetched fresh on load, never persisted locally. */
  installDefaultAccent: AccentPreset;
  /** Same personal-override-vs-installation-default pattern as the accent above, but for the structural background/surface palette (e.g. OLED-Black) rather than the brand color. */
  baseThemeOverride: BaseTheme | null;
  installDefaultBaseTheme: BaseTheme;
  /** What the header's light/dark button jumps back to, so switching modes keeps each side's chosen theme. */
  lastDarkTheme: BaseTheme;
  lastLightTheme: BaseTheme;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSection: (label: string) => void;
  /** Swaps between the most recently used light and dark theme. */
  toggleTheme: () => void;
  setAccentOverride: (preset: AccentPreset | null) => void;
  setInstallDefaultAccent: (preset: AccentPreset) => void;
  setBaseThemeOverride: (theme: BaseTheme | null) => void;
  setInstallDefaultBaseTheme: (theme: BaseTheme) => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      collapsedSections: {},
      accentOverride: null,
      installDefaultAccent: 'violet',
      baseThemeOverride: null,
      installDefaultBaseTheme: 'command-deck',
      lastDarkTheme: 'command-deck',
      lastLightTheme: 'daylight',
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSection: (label) =>
        set({ collapsedSections: { ...get().collapsedSections, [label]: !get().collapsedSections[label] } }),
      toggleTheme: () => {
        const current = get().baseThemeOverride ?? get().installDefaultBaseTheme;
        get().setBaseThemeOverride(isDarkBaseTheme(current) ? get().lastLightTheme : get().lastDarkTheme);
      },
      setAccentOverride: (preset) => {
        set({ accentOverride: preset });
        applyAccent(preset ?? get().installDefaultAccent);
      },
      setInstallDefaultAccent: (preset) => {
        set({ installDefaultAccent: preset });
        applyAccent(get().accentOverride ?? preset);
      },
      setBaseThemeOverride: (theme) => {
        const effective = theme ?? get().installDefaultBaseTheme;
        set({
          baseThemeOverride: theme,
          ...(isDarkBaseTheme(effective) ? { lastDarkTheme: effective } : { lastLightTheme: effective }),
        });
        applyBaseTheme(effective);
      },
      setInstallDefaultBaseTheme: (theme) => {
        set({ installDefaultBaseTheme: theme });
        applyBaseTheme(get().baseThemeOverride ?? theme);
      },
    }),
    {
      name: 'ts6-ui',
      version: 2,
      // Before v2 the light/dark choice was its own `theme` field, independent of the base
      // theme. It is now derived from the base theme, so anyone who had picked light keeps
      // a light look by landing on Daylight.
      migrate: (persisted, fromVersion) => {
        const state = persisted as Record<string, unknown>;
        if (fromVersion < 2 && state?.theme === 'light' && !state.baseThemeOverride) {
          return { ...state, baseThemeOverride: 'daylight' };
        }
        return state;
      },
      // installDefaultAccent/installDefaultBaseTheme always come fresh from the server (see
      // useWebguiThemeSync) - persisting a stale copy would let a browser miss an admin's later change to it.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        collapsedSections: state.collapsedSections,
        accentOverride: state.accentOverride,
        baseThemeOverride: state.baseThemeOverride,
        lastDarkTheme: state.lastDarkTheme,
        lastLightTheme: state.lastLightTheme,
      }),
      onRehydrateStorage: () => (state) => {
        applyAccent(state?.accentOverride ?? 'violet');
        applyBaseTheme(state?.baseThemeOverride ?? 'command-deck');
      },
    },
  ),
);
