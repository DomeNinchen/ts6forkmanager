import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { publicConfigApi, type PublicConfig } from '../api/public-config.api';
import { settingsApi } from '../api/settings.api';

export const PUBLIC_CONFIG_QUERY_KEY = ['public-config'] as const;

/** The settings readable without a login. `data` stays undefined while loading or when the backend can't be reached. */
export function usePublicConfig() {
  return useQuery({
    queryKey: PUBLIC_CONFIG_QUERY_KEY,
    queryFn: publicConfigApi.get,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** Admin: switch the storage notice on or off for everyone. */
export function useSetPrivacyNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => settingsApi.setPrivacyNotice(enabled),
    onSuccess: (data) =>
      qc.setQueryData<PublicConfig>(PUBLIC_CONFIG_QUERY_KEY, (old) => ({ ...old, privacyNotice: { enabled: data.enabled } })),
  });
}
