import type { PrismaClient } from '../generated/prisma/client.js';

/** How many requests the history keeps per server; older ones are deleted. */
export const MUSIC_REQUEST_HISTORY_LIMIT = 25;

/**
 * Remember a requested track (by its YouTube link) in the server's music
 * request history, moving it to the top if it is already there, and drop
 * whatever falls past the limit.
 */
export async function saveMusicRequest(
  prisma: PrismaClient,
  serverConfigId: number,
  url: string,
  title: string | undefined,
): Promise<void> {
  const requestedAt = new Date();
  const name = title || 'Unknown Title';
  await prisma.musicRequest.upsert({
    where: { serverConfigId_url: { serverConfigId, url } },
    update: { requestedAt, title: name },
    create: { serverConfigId, url, title: name, requestedAt },
  });

  const stale = await prisma.musicRequest.findMany({
    where: { serverConfigId },
    orderBy: { requestedAt: 'desc' },
    skip: MUSIC_REQUEST_HISTORY_LIMIT,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.musicRequest.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}
