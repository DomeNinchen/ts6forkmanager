import { de, enUS } from 'date-fns/locale';
import i18n from '@/lib/i18n';

/** Locale object for date-fns calls (formatDistanceToNow, etc.), matching the current WebGUI language. */
export function getDateFnsLocale() {
  return i18n.language?.startsWith('de') ? de : enUS;
}
