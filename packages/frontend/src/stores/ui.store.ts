import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccentPreset, BaseTheme } from '@/api/settings.api';

function applyTheme(theme: 'dark' | 'light') {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function applyAccent(preset: AccentPreset) {
  document.documentElement.dataset.accent = preset;
}

function applyBaseTheme(theme: BaseTheme) {
  document.documentElement.dataset.baseTheme = theme;
}

interface UiStore {
  sidebarCollapsed: boolean;
  /** Which sidebar nav section labels (e.g. "Management") are collapsed - independent of the whole-sidebar collapse above. */
  collapsedSections: Record<string, boolean>;
  theme: 'dark' | 'light';
  /** This user's personal choice, overriding the installation default below. null = follow the installation default. */
  accentOverride: AccentPreset | null;
  /** The admin-set installation-wide default (Settings → WebGui) - fetched fresh on load, never persisted locally. */
  installDefaultAccent: AccentPreset;
  /** Same personal-override-vs-installation-default pattern as the accent above, but for the structural background/surface palette (e.g. OLED-Black) rather than the brand color. */
  baseThemeOverride: BaseTheme | null;
  installDefaultBaseTheme: BaseTheme;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSection: (label: string) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
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
      theme: 'dark',
      accentOverride: null,
      installDefaultAccent: 'violet',
      baseThemeOverride: null,
      installDefaultBaseTheme: 'command-deck',
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSection: (label) =>
        set({ collapsedSections: { ...get().collapsedSections, [label]: !get().collapsedSections[label] } }),
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        applyTheme(next);
      },
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
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
        set({ baseThemeOverride: theme });
        applyBaseTheme(theme ?? get().installDefaultBaseTheme);
      },
      setInstallDefaultBaseTheme: (theme) => {
        set({ installDefaultBaseTheme: theme });
        applyBaseTheme(get().baseThemeOverride ?? theme);
      },
    }),
    {
      name: 'ts6-ui',
      // installDefaultAccent/installDefaultBaseTheme always come fresh from the server (see
      // useWebguiThemeSync) - persisting a stale copy would let a browser miss an admin's later change to it.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        collapsedSections: state.collapsedSections,
        theme: state.theme,
        accentOverride: state.accentOverride,
        baseThemeOverride: state.baseThemeOverride,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyTheme(state.theme);
        }
        applyAccent(state?.accentOverride ?? 'violet');
        applyBaseTheme(state?.baseThemeOverride ?? 'command-deck');
      },
    },
  ),
);
