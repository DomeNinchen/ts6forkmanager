import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { MUSIC_DIR, AUDIO_EXTENSIONS } from './media-dirs.js';
import { YOUTUBE_ID_PATTERN } from './music-library-scan.js';
import { getKeepPlayedSongs } from '../../utils/storage-settings.js';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * When "keep played songs" is off, deletes the playback cache !play/!queue/
 * !stream leave behind in MUSIC_DIR's root (bare `<video-id>.<ext>`, see
 * youtube.ts's downloadYouTube) once they're old enough that nothing is
 * likely to still be replaying them from cache. music-library-scan.ts never
 * catalogues these into the library while the setting is off, so anything
 * matching here is always untracked - the Song.filePath check is only a
 * safety net for a file that got catalogued before the setting was turned
 * off.
 */
export async function cleanupOnce(prisma: PrismaClient): Promise<void> {
  if (await getKeepPlayedSongs(prisma)) return;
  if (!fs.existsSync(MUSIC_DIR)) return;

  const knownPaths = new Set(
    (await prisma.song.findMany({ select: { filePath: true } })).map((s: { filePath: string }) => s.filePath),
  );

  const now = Date.now();
  for (const entry of fs.readdirSync(MUSIC_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) continue;
    if (!YOUTUBE_ID_PATTERN.test(path.basename(entry.name, ext))) continue;

    const filePath = path.join(MUSIC_DIR, entry.name);
    if (knownPaths.has(filePath)) continue;

    const stat = fs.statSync(filePath);
    if (now - stat.mtimeMs < MAX_AGE_MS) continue;

    try {
      fs.unlinkSync(filePath);
    } catch (err: any) {
      console.warn(`[PlayedSongCleanup] Failed to delete ${filePath}: ${err.message}`);
    }
  }
}

export function startPlayedSongCleanup(prisma: PrismaClient): void {
  setInterval(() => {
    cleanupOnce(prisma).catch((err) => console.warn(`[PlayedSongCleanup] ${err.message}`));
  }, CHECK_INTERVAL_MS);
}
