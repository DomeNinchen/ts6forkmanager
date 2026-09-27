import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/api/auth.api';
import { useAuthStore } from '@/stores/auth.store';
import type { SupportedLanguage } from '@/lib/i18n';

/** Keeps i18next in sync with the logged-in user's stored language preference.
 * Mount once near the app root - a null/undefined preference leaves the
 * browser-detected language (set by i18next-browser-languagedetector) alone. */
export function useLanguageSync() {
  const { i18n } = useTranslation();
  const userLanguage = useAuthStore((s) => s.user?.language);

  useEffect(() => {
    if (userLanguage && userLanguage !== i18n.language) {
      i18n.changeLanguage(userLanguage);
    }
  }, [userLanguage, i18n]);
}

/** Read/write the current user's language preference - changes it immediately
 * in the UI and persists it to their account. */
export function useLanguagePreference() {
  const { i18n } = useTranslation();
  const updateUser = useAuthStore((s) => s.updateUser);
  const storedLanguage = useAuthStore((s) => s.user?.language);

  const mutation = useMutation({
    mutationFn: (language: SupportedLanguage) => authApi.updateLanguage(language),
    onSuccess: (data, language) => {
      updateUser({ language: data.language ?? language });
      i18n.changeLanguage(language);
    },
  });

  return {
    language: (storedLanguage ?? i18n.language) as SupportedLanguage,
    setLanguage: mutation.mutate,
    isSaving: mutation.isPending,
  };
}
