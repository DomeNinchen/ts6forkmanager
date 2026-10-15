import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, type AccentPreset, type BaseTheme, type Design } from '../api/settings.api';
import { useUiStore } from '../stores/ui.store';
import { useAuthStore } from '../stores/auth.store';

/** Fetches the admin-set installation-wide accent default and applies it, unless this browser already has a personal override. Mount once near the app root. */
export function useWebguiThemeSync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const setInstallDefaultAccent = useUiStore((s) => s.setInstallDefaultAccent);
  const { data } = useQuery({
    queryKey: ['webgui-theme'],
    queryFn: settingsApi.getWebguiTheme,
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (data?.preset) {
      setInstallDefaultAccent(data.preset);
    }
  }, [data?.preset, setInstallDefaultAccent]);
}

export function useSetWebguiTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preset: AccentPreset) => settingsApi.setWebguiTheme(preset),
    onSuccess: (data) => qc.setQueryData(['webgui-theme'], data),
  });
}

/** Same pattern as useWebguiThemeSync above, but for the structural base theme (e.g. OLED-Black) rather than the accent color. Mount once near the app root. */
export function useWebguiBaseThemeSync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const setInstallDefaultBaseTheme = useUiStore((s) => s.setInstallDefaultBaseTheme);
  const { data } = useQuery({
    queryKey: ['webgui-base-theme'],
    queryFn: settingsApi.getWebguiBaseTheme,
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (data?.theme) {
      setInstallDefaultBaseTheme(data.theme);
    }
  }, [data?.theme, setInstallDefaultBaseTheme]);
}

export function useSetWebguiBaseTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (theme: BaseTheme) => settingsApi.setWebguiBaseTheme(theme),
    onSuccess: (data) => qc.setQueryData(['webgui-base-theme'], data),
  });
}

/** Same pattern again for the layout/typography design (Cockpit or Lounge). Mount once near the app root. */
export function useWebguiDesignSync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const setInstallDefaultDesign = useUiStore((s) => s.setInstallDefaultDesign);
  const { data } = useQuery({
    queryKey: ['webgui-design'],
    queryFn: settingsApi.getWebguiDesign,
    staleTime: 5 * 60 * 1000,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (data?.design) {
      setInstallDefaultDesign(data.design);
    }
  }, [data?.design, setInstallDefaultDesign]);
}

export function useSetWebguiDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (design: Design) => settingsApi.setWebguiDesign(design),
    onSuccess: (data) => qc.setQueryData(['webgui-design'], data),
  });
}

/** The design in effect for this browser: its own choice, else the installation default. */
export function useDesign(): Design {
  return useUiStore((s) => s.designOverride ?? s.installDefaultDesign);
}
