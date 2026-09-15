import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi, type AccentPreset } from '../api/settings.api';
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
