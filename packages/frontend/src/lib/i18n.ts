import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Every locale folder under src/locales/<code>/translation.json becomes a
// supported language automatically - adding one (e.g. a Crowdin sync PR
// landing a new packages/frontend/src/locales/fr/translation.json) needs no
// change here.
const localeModules = import.meta.glob('../locales/*/translation.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const path in localeModules) {
  const code = path.match(/\/locales\/([^/]+)\/translation\.json$/)?.[1];
  if (code) resources[code] = { translation: localeModules[path].default };
}

export const SUPPORTED_LANGUAGES = Object.keys(resources).sort();
export type SupportedLanguage = string;

/** A language's own name for itself (e.g. "Deutsch" for de, "Français" for
 * fr) via the runtime's own locale data - falls back to the raw code if the
 * runtime can't resolve it. Keeps the language switcher's labels working for
 * any language that shows up, without a hand-maintained name table. */
export function nativeLanguageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code;
  } catch {
    return code;
  }
}

// Storage key is separate from the user's stored server-side preference
// (auth.store's persisted user.language): this one is only a fallback for
// the detector when no account preference is set yet.
export const LANGUAGE_STORAGE_KEY = 'ts6-language';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

export default i18n;
