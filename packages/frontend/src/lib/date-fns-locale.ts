import { de, enUS, fr, pl, ptBR, zhCN } from 'date-fns/locale';

/** Locale object for date-fns calls (formatDistanceToNow, etc.) for a WebGUI
 * language code (pass i18n.language). Unlike the translation strings themselves,
 * a date-fns locale is a real per-language module and can't be discovered from
 * the locales/ folder - a language with no explicit case here (e.g. one
 * newly added via Crowdin) falls back to English formatting until its own
 * date-fns locale is added below. */
export function getDateFnsLocale(language: string | undefined) {
  const lang = language ?? '';
  if (lang.startsWith('de')) return de;
  if (lang.startsWith('fr')) return fr;
  if (lang.startsWith('pl')) return pl;
  // The pt and zh UI texts are Brazilian Portuguese and Simplified Chinese.
  if (lang.startsWith('pt')) return ptBR;
  if (lang.startsWith('zh')) return zhCN;
  return enUS;
}
