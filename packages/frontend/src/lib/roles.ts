import type { TFunction } from 'i18next';

export type UserRole = 'admin' | 'viewer' | 'bot-operator' | 'music-operator';

export function roleLabel(t: TFunction, role: string | undefined): string {
  switch (role) {
    case 'admin': return t('common.roles.admin');
    case 'viewer': return t('common.roles.viewer');
    case 'bot-operator': return t('common.roles.botOperator');
    case 'music-operator': return t('common.roles.musicOperator');
    default: return role ?? '';
  }
}
