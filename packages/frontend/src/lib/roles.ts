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

export function roleLabel(t: TFunction, role: string | undefined): string {
  const key = role ? ROLE_KEYS[role as UserRole] : undefined;
  return key ? t(key) : (role ?? '');
}
