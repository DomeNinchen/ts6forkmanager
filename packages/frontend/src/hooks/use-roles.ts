import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ROLE_PERMISSIONS, USER_ROLES, isUserRole, type UserPermission } from '@ts6/common';
import { rolesApi } from '@/api/bots.api';
import { roleLabel } from '@/lib/roles';

/**
 * The roles as the admin set them up (admin only): what a user can be given, each role's name and
 * what it may do now. Until the list has loaded, the fixed roles show their defaults.
 */
export function useRoleSetup(enabled = true) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list, enabled });

  const nameOf = (role: string | undefined) => roleLabel(t, role, data?.custom.find((c) => c.role === role)?.name);

  const options = [
    ...USER_ROLES.map((role) => ({ role: role as string, label: roleLabel(t, role) })),
    ...(data?.custom ?? []).map((c) => ({ role: c.role as string, label: c.name })),
  ];

  /** undefined for a role that is not known (yet). */
  const permissionsOf = (role: string): readonly UserPermission[] | undefined => {
    const fixed = data?.fixed.find((f) => f.role === role);
    if (fixed) return fixed.permissions;
    const custom = data?.custom.find((c) => c.role === role);
    if (custom) return custom.permissions;
    return isUserRole(role) ? ROLE_PERMISSIONS[role] : undefined;
  };

  return { data, options, nameOf, permissionsOf };
}
