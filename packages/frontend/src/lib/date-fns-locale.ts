import { de, enUS, zhCN } from 'date-fns/locale';
import i18n from '@/lib/i18n';

/** Locale object for date-fns calls (formatDistanceToNow, etc.), matching the
 * current WebGUI language. Unlike the translation strings themselves, a
 * date-fns locale is a real per-language module and can't be discovered from
 * the locales/ folder - a language with no explicit case here (e.g. one
 * newly added via Crowdin) falls back to English formatting until its own
 * date-fns locale is added below. */
export function getDateFnsLocale() {
  const language = i18n.language ?? '';
  if (language.startsWith('de')) return de;
  if (language.startsWith('zh')) return zhCN;
  return enUS;
}
