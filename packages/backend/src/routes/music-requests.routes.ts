import { Router, Request, Response, NextFunction } from 'express';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { MUSIC_REQUEST_HISTORY_LIMIT } from '../voice/music-request-history.js';

export const musicRequestRoutes: Router = Router({ mergeParams: true });

// Who asked the bot for what. Read by the Music Request History page (admin) and
// by the Music Bots page's play-song dialog (admins, bot operators, music
// operators - the same roles as the music library) - not by viewers.
musicRequestRoutes.use(requirePermission('music.manage'));

musicRequestRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const configId = parseInt(req.params.configId as string);
        if (isNaN(configId)) return res.status(400).json({ error: 'Invalid config id' });

        const requests = await req.app.locals.prisma.musicRequest.findMany({
            where: { serverConfigId: configId },
            orderBy: { requestedAt: 'desc' },
            take: MUSIC_REQUEST_HISTORY_LIMIT,
        });

        res.json(requests);
    } catch (error) {
        next(error);
    }
});
