import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccentPreset } from '@/api/settings.api';

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

interface UiStore {
  sidebarCollapsed: boolean;
  theme: 'dark' | 'light';
  /** This user's personal choice, overriding the installation default below. null = follow the installation default. */
  accentOverride: AccentPreset | null;
  /** The admin-set installation-wide default (Settings → WebGui) - fetched fresh on load, never persisted locally. */
  installDefaultAccent: AccentPreset;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setAccentOverride: (preset: AccentPreset | null) => void;
  setInstallDefaultAccent: (preset: AccentPreset) => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      theme: 'dark',
      accentOverride: null,
      installDefaultAccent: 'violet',
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
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
    }),
    {
      name: 'ts6-ui',
      // installDefaultAccent always comes fresh from the server (see useWebguiThemeSync) -
      // persisting a stale copy would let a browser miss an admin's later change to it.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        accentOverride: state.accentOverride,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyTheme(state.theme);
        }
        applyAccent(state?.accentOverride ?? 'violet');
      },
    },
  ),
);
