import {
  EDITABLE_ROLES, ESCALATING_PERMISSIONS, ROLE_PERMISSIONS, USER_PERMISSIONS, customRoleKey, isUserRole,
  roleHasPermission, type RoleTable, type UserPermission,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * What each role may do right now: the fixed roles' defaults, the admin's changes to them
 * (RolePermissionOverride) and the custom roles (CustomRole, keyed "custom:<id>"). Held in memory
 * so every request and WebSocket event checks against it without a query; reloaded at start and
 * after every change through /api/roles (this is a single process).
 *
 * Before the first load it holds the defaults, which is what a database without changes holds.
 */
let table: RoleTable = { ...ROLE_PERMISSIONS };
let customNames = new Map<string, string>();

/** Whether the role may do this, as the roles are set up now. An unknown role may do nothing. */
export function mayRole(role: string | undefined, permission: UserPermission): boolean {
  return roleHasPermission(role, permission, table);
}

/** The role's permissions now (every one for the admin, none for an unknown role). */
export function permissionsOf(role: string | undefined): readonly UserPermission[] {
  if (role === 'admin') return USER_PERMISSIONS;
  return role !== undefined && Object.hasOwn(table, role) ? table[role] : [];
}

/** Whether a user can be given this role: a fixed one or an existing custom one. */
export function isAssignableRole(role: unknown): role is string {
  return isUserRole(role) || (typeof role === 'string' && customNames.has(role));
}

/** The name of a custom role, undefined for a fixed one (the frontend translates those). */
export function customRoleName(role: string): string | undefined {
  return customNames.get(role);
}

/** What the frontend needs to know about the signed-in user's own role. */
export function roleInfo(role: string): { permissions: readonly UserPermission[]; roleName?: string } {
  return { permissions: permissionsOf(role), roleName: customRoleName(role) };
}

/** A stored permission list, read leniently: unknown names are dropped, so a bad row grants less, never more. */
export function parseStoredPermissions(json: string, custom: boolean): UserPermission[] {
  let list: unknown;
  try { list = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return USER_PERMISSIONS.filter((p) => list.includes(p) && !(custom && ESCALATING_PERMISSIONS.includes(p)));
}

export async function loadRoleTable(prisma: PrismaClient): Promise<void> {
  const [overrides, customs] = await Promise.all([
    prisma.rolePermissionOverride.findMany(),
    prisma.customRole.findMany(),
  ]);
  const next: Record<string, readonly UserPermission[]> = { ...ROLE_PERMISSIONS };
  for (const o of overrides) {
    if ((EDITABLE_ROLES as readonly string[]).includes(o.role)) next[o.role] = parseStoredPermissions(o.permissions, false);
  }
  const names = new Map<string, string>();
  for (const c of customs) {
    next[customRoleKey(c.id)] = parseStoredPermissions(c.permissions, true);
    names.set(customRoleKey(c.id), c.name);
  }
  table = next;
  customNames = names;
}
