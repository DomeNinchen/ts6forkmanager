import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserSettingKey, UserSettings } from '@ts6/common';
import { userSettingsApi } from '@/api/user-settings.api';
import { useAuthStore } from '@/stores/auth.store';

// Keyed by user id: logging out does not clear the query cache, so the next
// account signing in in the same tab must not be handed these.
const settingsKey = (userId: number | undefined) => ['user-settings', userId];

/** The signed-in user's settings, as stored on their account. */
export function useUserSettings() {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: settingsKey(userId),
    queryFn: userSettingsApi.get,
    enabled: userId !== undefined,
  });
}

/** Stores one setting; `null` deletes it, so the default applies again. */
export function useSaveUserSetting<K extends UserSettingKey>(key: K) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: (value: NonNullable<UserSettings[K]> | null) =>
      value === null ? userSettingsApi.reset(key) : userSettingsApi.set(key, value),
    // Written into the cache right away rather than refetched, so the page never shows the old value in between.
    onSuccess: (_data, value) =>
      queryClient.setQueryData<UserSettings>(settingsKey(userId), (old) => {
        const next: UserSettings = { ...old };
        if (value === null) delete next[key];
        else next[key] = value as UserSettings[K];
        return next;
      }),
  });
}
