import { Router, Request, Response } from 'express';
import {
  EDITABLE_ROLES, ESCALATING_PERMISSIONS, ROLE_PERMISSIONS, USER_PERMISSIONS, customRoleKey,
  type UserPermission, type UserRole,
} from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import { loadRoleTable, parseStoredPermissions, permissionsOf } from '../utils/role-table.js';

/**
 * The roles as the admin sets them up (mounted admin-only in app.ts): the fixed roles' permissions
 * can be changed and reset, custom roles created, changed and deleted. The admin role itself is
 * not editable, and a custom role never holds ESCALATING_PERMISSIONS.
 */
export const roleRoutes: Router = Router();

const NAME_MAX = 32;

/** A permission list from the request: known, distinct names only - anything else is a 400. */
function permissionsFrom(body: unknown, custom: boolean): UserPermission[] {
  const list = (body as { permissions?: unknown } | undefined)?.permissions;
  if (!Array.isArray(list) || !list.every((p) => typeof p === 'string')) throw new AppError(400, 'permissions must be a list of permission names');
  const unknown = list.filter((p) => !(USER_PERMISSIONS as readonly string[]).includes(p));
  if (unknown.length) throw new AppError(400, `Unknown permission: ${unknown.join(', ')}`);
  if (custom) {
    const escalating = list.filter((p) => (ESCALATING_PERMISSIONS as readonly string[]).includes(p));
    if (escalating.length) throw new AppError(400, `A custom role cannot hold: ${escalating.join(', ')}`);
  }
  return USER_PERMISSIONS.filter((p) => list.includes(p));
}

function nameFrom(body: unknown): string {
  const name = (body as { name?: unknown } | undefined)?.name;
  if (typeof name !== 'string' || !name.trim()) throw new AppError(400, 'A name is required');
  if (name.trim().length > NAME_MAX) throw new AppError(400, `The name can be at most ${NAME_MAX} characters`);
  return name.trim();
}

function editableRole(param: unknown): UserRole {
  if (typeof param !== 'string' || !(EDITABLE_ROLES as readonly string[]).includes(param)) throw new AppError(404, 'Role not found');
  return param as UserRole;
}

function customId(param: unknown): number {
  const id = typeof param === 'string' && /^[1-9]\d{0,9}$/.test(param) ? Number(param) : NaN;
  if (!Number.isSafeInteger(id)) throw new AppError(404, 'Role not found');
  return id;
}

/** Name taken, ignoring case (the unique index only catches the exact spelling). */
async function assertNameFree(req: Request, name: string, exceptId?: number) {
  const all = await req.app.locals.prisma.customRole.findMany({ select: { id: true, name: true } });
  if (all.some((r: { id: number; name: string }) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError(409, 'A role with this name already exists');
  }
}

roleRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const [overrides, customs, users] = await Promise.all([
      prisma.rolePermissionOverride.findMany({ select: { role: true } }),
      prisma.customRole.findMany({ orderBy: { name: 'asc' } }),
      prisma.user.findMany({ select: { username: true, role: true }, orderBy: { username: 'asc' } }),
    ]);
    const changed = new Set(overrides.map((o: { role: string }) => o.role));
    const usersOf = (role: string) => users.filter((u: { role: string }) => u.role === role).map((u: { username: string }) => u.username);
    res.json({
      fixed: EDITABLE_ROLES.map((role) => ({
        role,
        permissions: permissionsOf(role),
        defaults: ROLE_PERMISSIONS[role],
        changed: changed.has(role),
        users: usersOf(role),
      })),
      custom: customs.map((c: { id: number; name: string; permissions: string }) => ({
        id: c.id,
        role: customRoleKey(c.id),
        name: c.name,
        permissions: parseStoredPermissions(c.permissions, true),
        users: usersOf(customRoleKey(c.id)),
      })),
    });
  } catch (err) { next(err); }
});

roleRoutes.put('/fixed/:role', async (req: Request, res: Response, next) => {
  try {
    const role = editableRole(req.params.role);
    const permissions = permissionsFrom(req.body, false);
    const prisma = req.app.locals.prisma;
    await prisma.rolePermissionOverride.upsert({
      where: { role },
      create: { role, permissions: JSON.stringify(permissions) },
      update: { permissions: JSON.stringify(permissions) },
    });
    await loadRoleTable(prisma);
    res.status(204).send();
  } catch (err) { next(err); }
});

// DELETE /fixed/:role - back to the role's defaults
roleRoutes.delete('/fixed/:role', async (req: Request, res: Response, next) => {
  try {
    const role = editableRole(req.params.role);
    const prisma = req.app.locals.prisma;
    await prisma.rolePermissionOverride.deleteMany({ where: { role } });
    await loadRoleTable(prisma);
    res.status(204).send();
  } catch (err) { next(err); }
});

roleRoutes.post('/custom', async (req: Request, res: Response, next) => {
  try {
    const name = nameFrom(req.body);
    const permissions = permissionsFrom(req.body, true);
    const prisma = req.app.locals.prisma;
    await assertNameFree(req, name);
    let created;
    try {
      created = await prisma.customRole.create({ data: { name, permissions: JSON.stringify(permissions) } });
    } catch (err: any) {
      if (err.code === 'P2002') throw new AppError(409, 'A role with this name already exists');
      throw err;
    }
    await loadRoleTable(prisma);
    res.status(201).json({ id: created.id, role: customRoleKey(created.id) });
  } catch (err) { next(err); }
});

roleRoutes.put('/custom/:id', async (req: Request, res: Response, next) => {
  try {
    const id = customId(req.params.id);
    const name = nameFrom(req.body);
    const permissions = permissionsFrom(req.body, true);
    const prisma = req.app.locals.prisma;
    if (!await prisma.customRole.findUnique({ where: { id } })) throw new AppError(404, 'Role not found');
    await assertNameFree(req, name, id);
    try {
      await prisma.customRole.update({ where: { id }, data: { name, permissions: JSON.stringify(permissions) } });
    } catch (err: any) {
      if (err.code === 'P2002') throw new AppError(409, 'A role with this name already exists');
      throw err;
    }
    await loadRoleTable(prisma);
    res.status(204).send();
  } catch (err) { next(err); }
});

// DELETE /custom/:id - refused while any user still has the role (the answer names them)
roleRoutes.delete('/custom/:id', async (req: Request, res: Response, next) => {
  try {
    const id = customId(req.params.id);
    const prisma = req.app.locals.prisma;
    const role = customRoleKey(id);
    // One transaction, so a user cannot be given the role between the check and the delete
    await prisma.$transaction(async (tx: any) => {
      const holders = await tx.user.findMany({ where: { role }, select: { username: true }, orderBy: { username: 'asc' } });
      if (holders.length) {
        throw new AppError(409, 'This role is still given to users', holders.map((u: { username: string }) => u.username).join(', '), 'ROLE_IN_USE');
      }
      const { count } = await tx.customRole.deleteMany({ where: { id } });
      if (count === 0) throw new AppError(404, 'Role not found');
    });
    await loadRoleTable(prisma);
    res.status(204).send();
  } catch (err) { next(err); }
});
