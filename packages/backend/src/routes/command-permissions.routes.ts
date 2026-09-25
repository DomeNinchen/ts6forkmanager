import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';

// Chat-command permissions for TeamSpeak bot commands (MusicBot's `!play`
// etc.) - DomeNinchen/ts6forkmanager#184. Scoped by serverConfigId only, not
// virtual server, matching every other part of the music-bot feature (see
// the sid=1 comment in voice/voice-bot.ts).
export const commandPermissionRoutes: Router = Router({ mergeParams: true });

const getPrisma = (req: Request) => req.app.locals.prisma;
const getConfigId = (req: Request) => parseInt(String(req.params.configId));

commandPermissionRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const serverConfigId = getConfigId(req);
    const [permissions, adminGroups] = await Promise.all([
      getPrisma(req).botCommandPermission.findMany({ where: { serverConfigId }, orderBy: { command: 'asc' } }),
      getPrisma(req).botCommandAdminGroup.findMany({ where: { serverConfigId } }),
    ]);
    res.json({ permissions, adminGroupIds: adminGroups.map((g: { groupId: string }) => g.groupId) });
  } catch (err) { next(err); }
});

// Registered ahead of the /:command routes below so it can never be
// swallowed by that param route (it wouldn't be anyway - different segment
// count - but this keeps the ordering unambiguous at a glance).
commandPermissionRoutes.put('/admin-groups', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const serverConfigId = getConfigId(req);
    const groupIds: string[] = Array.isArray(req.body.groupIds)
      ? req.body.groupIds.map((id: unknown) => String(id)).filter(Boolean)
      : [];
    const prisma = getPrisma(req);
    await prisma.$transaction([
      prisma.botCommandAdminGroup.deleteMany({ where: { serverConfigId } }),
      ...groupIds.map((groupId) =>
        prisma.botCommandAdminGroup.create({ data: { serverConfigId, groupId } }),
      ),
    ]);
    res.json({ groupIds });
  } catch (err) { next(err); }
});

commandPermissionRoutes.put('/:command', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const serverConfigId = getConfigId(req);
    const command = String(req.params.command);
    const allowedGroupIds = String(req.body.allowedGroupIds ?? '');
    const perm = await getPrisma(req).botCommandPermission.upsert({
      where: { serverConfigId_command: { serverConfigId, command } },
      update: { allowedGroupIds },
      create: { serverConfigId, command, allowedGroupIds },
    });
    res.json(perm);
  } catch (err) { next(err); }
});

commandPermissionRoutes.delete('/:command', requireRole('admin'), async (req: Request, res: Response, next) => {
  try {
    const serverConfigId = getConfigId(req);
    const command = String(req.params.command);
    await getPrisma(req).botCommandPermission.deleteMany({ where: { serverConfigId, command } });
    res.status(204).end();
  } catch (err) { next(err); }
});
