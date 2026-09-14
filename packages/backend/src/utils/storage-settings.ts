import type { PrismaClient } from '../generated/prisma/client.js';

const DB_KEY = 'keep_played_songs';

/**
 * Whether songs downloaded via chat commands (!play/!queue/!stream) should be
 * catalogued into the music library and kept indefinitely (the default,
 * matching this app's behavior before this setting existed) or left as an
 * untracked playback cache that played-song-cleanup.ts deletes after an hour.
 * Deliberately does not affect songs added through the Library tab (upload or
 * "download by URL") - those are a deliberate add-to-collection action.
 */
export async function getKeepPlayedSongs(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: DB_KEY } });
  if (!row) return true;
  return row.value === 'true';
}

export async function setKeepPlayedSongs(prisma: PrismaClient, value: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: DB_KEY },
    create: { key: DB_KEY, value: String(value) },
    update: { value: String(value) },
  });
}
