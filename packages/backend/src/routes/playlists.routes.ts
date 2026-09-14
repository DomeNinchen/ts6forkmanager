import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';

export const playlistRoutes: Router = Router();

playlistRoutes.use(requireRole('admin', 'bot-operator', 'music-operator'));

/**
 * Playlists aren't mounted per-server (musicBotId is optional - a playlist
 * with none is a shared/unassigned one, not tied to any server), so unlike
 * music-library/radio-stations there's no requireServerAccess upstream of
 * this router. For a non-admin: an unassigned playlist is always visible
 * (nothing server-specific to gate), an assigned one only if they have
 * access to that bot's server.
 */
async function assertPlaylistAccess(req: Request, prisma: any, playlist: { musicBotId: number | null }): Promise<void> {
  if (req.user!.role === 'admin' || playlist.musicBotId == null) return;
  const bot = await prisma.musicBot.findUnique({ where: { id: playlist.musicBotId }, select: { serverConfigId: true } });
  if (!bot) return; // dangling reference, nothing to gate against
  const access = await prisma.userServerAccess.findUnique({
    where: { userId_serverConfigId: { userId: req.user!.id, serverConfigId: bot.serverConfigId } },
  });
  if (!access) throw new AppError(403, 'No access to this server');
}

// GET / — List playlists
playlistRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const musicBotId = req.query.musicBotId ? parseInt(String(req.query.musicBotId)) : undefined;
    if (musicBotId !== undefined) await assertPlaylistAccess(req, prisma, { musicBotId });
    const playlists = await prisma.playlist.findMany({
      where: {
        ...(musicBotId ? { musicBotId } : {}),
        ...(req.user!.role === 'admin' ? {} : {
          OR: [
            { musicBotId: null },
            { musicBot: { serverConfig: { userAccess: { some: { userId: req.user!.id } } } } },
          ],
        }),
      },
      include: { _count: { select: { songs: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(playlists.map((p: any) => ({
      id: p.id,
      name: p.name,
      musicBotId: p.musicBotId,
      songCount: p._count.songs,
      createdAt: p.createdAt,
    })));
  } catch (err) { next(err); }
});

// Centralizes the same access check for every /:id/... route below (there
// are several) instead of repeating it in each handler.
playlistRoutes.param('id', async (req: Request, res: Response, next, idParam) => {
  try {
    if (req.user!.role === 'admin') return next();
    const id = parseInt(idParam);
    if (isNaN(id)) return next(new AppError(400, 'Invalid playlist id'));
    const prisma = req.app.locals.prisma;
    const playlist = await prisma.playlist.findUnique({ where: { id }, select: { musicBotId: true } });
    if (!playlist) return next(new AppError(404, 'Playlist not found'));
    await assertPlaylistAccess(req, prisma, playlist);
    next();
  } catch (err) { next(err); }
});

// GET /:id — Get playlist with songs
playlistRoutes.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(req.params.id as string);
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        songs: {
          include: { song: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!playlist) throw new AppError(404, 'Playlist not found');

    res.json({
      id: playlist.id,
      name: playlist.name,
      musicBotId: playlist.musicBotId,
      songCount: playlist.songs.length,
      createdAt: playlist.createdAt,
      songs: playlist.songs.map((ps: any) => ({
        id: ps.song.id,
        title: ps.song.title,
        artist: ps.song.artist,
        duration: ps.song.duration,
        source: ps.song.source,
        sourceUrl: ps.song.sourceUrl,
        fileSize: ps.song.fileSize,
        createdAt: ps.song.createdAt,
        position: ps.position,
      })),
    });
  } catch (err) { next(err); }
});

// POST / — Create playlist
playlistRoutes.post('/', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const { name, musicBotId } = req.body;
    if (!name) throw new AppError(400, 'name is required');
    const parsedMusicBotId = musicBotId ? parseInt(musicBotId) : null;
    if (parsedMusicBotId != null) await assertPlaylistAccess(req, prisma, { musicBotId: parsedMusicBotId });

    const playlist = await prisma.playlist.create({
      data: {
        name,
        musicBotId: parsedMusicBotId,
      },
    });

    res.status(201).json({ id: playlist.id, name: playlist.name });
  } catch (err) { next(err); }
});

// PUT /:id — Update playlist
playlistRoutes.put('/:id', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const id = parseInt(req.params.id as string);
    const { name, musicBotId } = req.body;
    const parsedMusicBotId = musicBotId !== undefined ? (musicBotId ? parseInt(musicBotId) : null) : undefined;
    if (parsedMusicBotId != null) await assertPlaylistAccess(req, prisma, { musicBotId: parsedMusicBotId }); // reassigning to a bot they also need access to

    await prisma.playlist.update({
      where: { id },
      data: {
        ...(name != null && { name }),
        ...(parsedMusicBotId !== undefined && { musicBotId: parsedMusicBotId }),
      },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /:id — Delete playlist
playlistRoutes.delete('/:id', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    await prisma.playlist.delete({ where: { id: parseInt(req.params.id as string) } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /:id/songs — Add song to playlist
playlistRoutes.post('/:id/songs', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const playlistId = parseInt(req.params.id as string);
    const { songId } = req.body;
    if (!songId) throw new AppError(400, 'songId is required');

    // Get next position
    const maxPos = await prisma.playlistSong.aggregate({
      where: { playlistId },
      _max: { position: true },
    });
    const nextPosition = (maxPos._max.position ?? -1) + 1;

    await prisma.playlistSong.create({
      data: {
        playlistId,
        songId: parseInt(songId),
        position: nextPosition,
      },
    });

    res.status(201).json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /:id/songs/:songId — Remove song from playlist
playlistRoutes.delete('/:id/songs/:songId', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const playlistId = parseInt(req.params.id as string);
    const songId = parseInt(req.params.songId as string);

    await prisma.playlistSong.deleteMany({
      where: { playlistId, songId },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /:id/songs/reorder — Reorder songs
playlistRoutes.put('/:id/songs/reorder', async (req: Request, res: Response, next) => {
  try {
    const prisma = req.app.locals.prisma;
    const playlistId = parseInt(req.params.id as string);
    const { songIds } = req.body;
    if (!Array.isArray(songIds)) throw new AppError(400, 'songIds array is required');

    // Update positions in a transaction
    await prisma.$transaction(
      songIds.map((songId: number, index: number) =>
        prisma.playlistSong.updateMany({
          where: { playlistId, songId },
          data: { position: index },
        })
      )
    );

    res.json({ success: true });
  } catch (err) { next(err); }
});
