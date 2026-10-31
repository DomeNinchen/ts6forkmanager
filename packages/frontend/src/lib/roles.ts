import type { TFunction } from 'i18next';
import type { UserRole } from '@ts6/common';

export type { UserRole };

const ROLE_KEYS: Record<UserRole, string> = {
  admin: 'common.roles.admin',
  'server-admin': 'common.roles.serverAdmin',
  moderator: 'common.roles.moderator',
  viewer: 'common.roles.viewer',
  'bot-operator': 'common.roles.botOperator',
  'music-operator': 'common.roles.musicOperator',
};

/** A fixed role's translated name, or `customName` for a custom role (unknown custom role: "Custom role"). */
export function roleLabel(t: TFunction, role: string | undefined, customName?: string): string {
  const key = role ? ROLE_KEYS[role as UserRole] : undefined;
  if (key) return t(key);
  if (role?.startsWith('custom:')) return customName ?? t('common.roles.custom');
  return role ?? '';
}
