import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { validatePassword } from '../utils/validate-password.js';

const VALID_ROLES = ['admin', 'viewer', 'bot-operator', 'music-operator'];

export const userRoutes: Router = Router();

userRoutes.use(requireRole('admin'));

userRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const users = await prisma.user.findMany({
      select: { id: true, username: true, email: true, authProvider: true, displayName: true, role: true, enabled: true, createdAt: true, lastLoginAt: true },
      orderBy: { id: 'asc' },
    });
    res.json(users);
  } catch (err) { next(err); }
});

userRoutes.post('/', async (req: Request, res: Response, next) => {
  try {
    const { username, password, displayName, role } = req.body;
    if (!username || !password || !displayName) throw new AppError(400, 'Username, password, and display name required');

    const pwError = validatePassword(password);
    if (pwError) throw new AppError(400, pwError);

    const assignedRole = role || 'viewer';
    if (!VALID_ROLES.includes(assignedRole)) throw new AppError(400, `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);

    const prisma = req.app.locals.prisma;
    const passwordHash = await bcrypt.hash(password, 12);
    let user;
    try {
      user = await prisma.user.create({
        data: { username, passwordHash, displayName, role: assignedRole },
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new AppError(400, 'Username already taken');
      throw err;
    }

    res.status(201).json({ id: user.id, username: user.username });
  } catch (err) { next(err); }
});

userRoutes.put('/:userId', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(String(req.params.userId));
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError(404, 'User not found');

    // Would this request take an active admin's admin status away (role change or disable)?
    const wouldLoseAdminStatus = target.role === 'admin' && target.enabled && (
      (req.body.role !== undefined && req.body.role !== 'admin') ||
      req.body.enabled === false
    );
    if (wouldLoseAdminStatus) {
      if (id === req.user!.id) throw new AppError(400, 'You cannot remove your own admin role or disable your own account');
      const otherActiveAdmins = await prisma.user.count({ where: { role: 'admin', enabled: true, id: { not: id } } });
      if (otherActiveAdmins === 0) throw new AppError(400, 'Cannot remove the last active admin');
    }

    const data: any = {};
    if (req.body.username !== undefined) data.username = req.body.username;
    if (req.body.displayName !== undefined) data.displayName = req.body.displayName;
    if (req.body.role !== undefined) {
      if (!VALID_ROLES.includes(req.body.role)) throw new AppError(400, `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
      data.role = req.body.role;
    }
    if (req.body.enabled !== undefined) data.enabled = req.body.enabled;
    if (req.body.password) {
      const pwError = validatePassword(req.body.password);
      if (pwError) throw new AppError(400, pwError);
      data.passwordHash = await bcrypt.hash(req.body.password, 12);
    }

    try {
      await prisma.user.update({ where: { id }, data });
    } catch (err: any) {
      if (err.code === 'P2002') throw new AppError(400, 'Username already taken');
      throw err;
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

userRoutes.delete('/:userId', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(String(req.params.userId));
    if (id === req.user!.id) throw new AppError(400, 'Cannot delete your own account');

    const target = await prisma.user.findUnique({ where: { id } });
    if (target?.role === 'admin' && target.enabled) {
      const otherActiveAdmins = await prisma.user.count({ where: { role: 'admin', enabled: true, id: { not: id } } });
      if (otherActiveAdmins === 0) throw new AppError(400, 'Cannot delete the last active admin');
    }

    await prisma.user.delete({ where: { id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /:userId/sessions - active refresh tokens (roughly: logged-in devices/browsers) for this user.
// Each row is one refresh-token "family" member; a session ends when it expires, is rotated away
// on its own (still counts as active in the meantime), or is explicitly revoked below.
userRoutes.get('/:userId/sessions', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(String(req.params.userId));
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: id },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(sessions);
  } catch (err) { next(err); }
});

// DELETE /:userId/sessions - revoke all of this user's sessions (force logout everywhere).
userRoutes.delete('/:userId/sessions', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(String(req.params.userId));
    const { count } = await prisma.refreshToken.deleteMany({ where: { userId: id } });
    res.json({ revoked: count });
  } catch (err) { next(err); }
});

// DELETE /:userId/sessions/:sessionId - revoke a single session.
userRoutes.delete('/:userId/sessions/:sessionId', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const userId = parseInt(String(req.params.userId));
    const sessionId = parseInt(String(req.params.sessionId));
    await prisma.refreshToken.deleteMany({ where: { id: sessionId, userId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /:userId/server-access - which TS server connections this user (if 'viewer') can see.
// Meaningless for 'admin' users, who bypass this check entirely (see middleware/server-access.ts) -
// still readable/settable either way so switching a user's role back to 'viewer' later doesn't
// silently strand them with no access at all.
userRoutes.get('/:userId/server-access', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(String(req.params.userId));
    const rows = await prisma.userServerAccess.findMany({ where: { userId: id }, select: { serverConfigId: true } });
    res.json({ serverConfigIds: rows.map((r: { serverConfigId: number }) => r.serverConfigId) });
  } catch (err) { next(err); }
});

// PUT /:userId/server-access - replace the full set of servers this user can access (body: { serverConfigIds: number[] })
userRoutes.put('/:userId/server-access', async (req: Request, res: Response, next) => {
  try {
    const id = parseInt(String(req.params.userId));
    const serverConfigIds = req.body.serverConfigIds;
    if (!Array.isArray(serverConfigIds) || !serverConfigIds.every((n) => Number.isInteger(n))) {
      throw new AppError(400, 'serverConfigIds must be an array of integers');
    }

    const prisma = req.app.locals.prisma;
    await prisma.$transaction([
      prisma.userServerAccess.deleteMany({ where: { userId: id } }),
      ...serverConfigIds.map((serverConfigId: number) =>
        prisma.userServerAccess.create({ data: { userId: id, serverConfigId } })
      ),
    ]);

    res.status(204).send();
  } catch (err) { next(err); }
});
