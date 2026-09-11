import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { MUSIC_DIR, AUDIO_DIR, VIDEO_DIR, AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from './media-dirs.js';
import { getYouTubeUrlInfo } from './youtube.js';

// `!play`/`!queue`/`!stream` download straight to a bare `<video-id>.<ext>`
// (see youtube.ts's downloadYouTube) as a playback cache, never registering
// a Song row - so scan is the first thing to ever see these files, with
// nothing but the id-as-filename to go on. Recognize the shape so we can
// look the real title up instead of cataloguing the id as if it were one.
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ], { shell: false });

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        const parsed = JSON.parse(output);
        resolve(parseFloat(parsed.format.duration) || 0);
      } catch {
        reject(new Error('Failed to parse ffprobe output'));
      }
    });
    proc.on('error', reject);
  });
}

/** Look up a YouTube video's real title/uploader by id. Best-effort: null on any failure or timeout. */
async function recoverYouTubeTitle(videoId: string, timeoutMs = 15000): Promise<{ title: string; artist: string | null } | null> {
  try {
    const result = await Promise.race([
      getYouTubeUrlInfo(`https://youtube.com/watch?v=${videoId}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    const item = result?.items?.[0];
    if (!item?.title) return null;
    return { title: item.title, artist: item.artist || null };
  } catch {
    return null;
  }
}

interface ScanOptions {
  /**
   * Look up real titles for bare-video-id filenames via yt-dlp (network call
   * per unknown id, bounded but not free) and fix up any already-catalogued
   * rows with an id-shaped title. Off by default so the automatic
   * startup scan stays fast/offline; the on-demand "Scan for New Files"
   * button turns it on.
   */
  recoverYouTubeTitles?: boolean;
}

async function scanDir(
  prisma: PrismaClient,
  serverConfigId: number,
  dir: string,
  extensions: string[],
  mediaType: 'audio' | 'video',
  knownPaths: Set<string>,
  recoverYouTubeTitles: boolean,
): Promise<{ added: number; skipped: number }> {
  if (!fs.existsSync(dir)) return { added: 0, skipped: 0 };

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let added = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Dotfiles include our own temp video-stream downloads (.stream-<ts>.mp4) - never library content.
    if (entry.name.startsWith('.')) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!extensions.includes(ext)) continue;

    const filePath = path.join(dir, entry.name);
    if (knownPaths.has(filePath)) {
      skipped++;
      continue;
    }

    const baseName = path.basename(entry.name, ext);
    const idLike = mediaType === 'audio' && YOUTUBE_ID_PATTERN.test(baseName);

    let title = baseName;
    let artist: string | null = null;
    if (idLike) {
      if (!recoverYouTubeTitles) {
        // Cataloguing this now would only ever get it a raw-id title (see
        // module comment) - wait for an on-demand scan to do it properly.
        continue;
      }
      const recovered = await recoverYouTubeTitle(baseName);
      if (recovered) {
        title = recovered.title;
        artist = recovered.artist;
      }
    } else {
      const dashIdx = baseName.indexOf(' - ');
      if (dashIdx > 0) {
        artist = baseName.substring(0, dashIdx).trim();
        title = baseName.substring(dashIdx + 3).trim();
      }
    }

    let duration: number | null = null;
    try {
      duration = await getAudioDuration(filePath);
    } catch { /* ignore duration extraction failure */ }

    const stat = fs.statSync(filePath);
    await prisma.song.create({
      data: {
        title,
        artist,
        duration,
        filePath,
        source: 'local',
        mediaType,
        fileSize: stat.size,
        serverConfigId,
      },
    });
    added++;
    knownPaths.add(filePath);
  }

  return { added, skipped };
}

/**
 * Fix up already-catalogued rows that only ever got a bare video id as their
 * title - i.e. an earlier scan (before title recovery existed, or run with
 * it off) added them from a `!play`-cached file with nothing better to go
 * on. Only touches rows whose title still exactly equals the file's own
 * basename and looks like a video id, so it can't mistake genuine content
 * for one of these. Best-effort per row; a row is left alone if recovery
 * fails (network/deleted video/etc).
 */
async function healYouTubeTitles(prisma: PrismaClient, serverConfigId: number): Promise<number> {
  const candidates = await prisma.song.findMany({
    where: { serverConfigId, mediaType: 'audio', source: 'local', artist: null },
    select: { id: true, title: true, filePath: true },
  });

  let healed = 0;
  for (const song of candidates) {
    const base = path.basename(song.filePath, path.extname(song.filePath));
    if (base !== song.title || !YOUTUBE_ID_PATTERN.test(base)) continue;

    const recovered = await recoverYouTubeTitle(base);
    if (!recovered) continue;

    await prisma.song.update({
      where: { id: song.id },
      data: { title: recovered.title, artist: recovered.artist },
    });
    healed++;
  }

  return healed;
}

/**
 * Scan for audio/video files not yet tracked as a Song for this server config
 * and add them. Covers the organized `music/`/`video/` subfolders (where new
 * uploads/downloads land) plus MUSIC_DIR's own root, for files that were
 * already there before the subfolder split (or dropped in directly, e.g. a
 * volume shared with another app) - see clusterzx/ts6-manager#79 and #33.
 * Same title/artist parsing and duration extraction as the manual upload handler.
 */
export async function scanMusicLibrary(
  prisma: PrismaClient,
  serverConfigId: number,
  options: ScanOptions = {},
): Promise<{ added: number; skipped: number; healed: number }> {
  const recoverYouTubeTitles = options.recoverYouTubeTitles ?? false;

  const existing = await prisma.song.findMany({
    where: { serverConfigId },
    select: { filePath: true },
  });
  const knownPaths = new Set(existing.map((s: { filePath: string }) => s.filePath));

  let added = 0;
  let skipped = 0;

  const passes: Array<{ dir: string; extensions: string[]; mediaType: 'audio' | 'video' }> = [
    { dir: AUDIO_DIR, extensions: AUDIO_EXTENSIONS, mediaType: 'audio' },
    { dir: VIDEO_DIR, extensions: VIDEO_EXTENSIONS, mediaType: 'video' },
    // Legacy flat layout: classify by extension, defaulting the ambiguous
    // .webm case to audio to match this scan's own pre-subfolder behavior.
    { dir: MUSIC_DIR, extensions: VIDEO_EXTENSIONS.filter((e) => e !== '.webm'), mediaType: 'video' },
    { dir: MUSIC_DIR, extensions: AUDIO_EXTENSIONS, mediaType: 'audio' },
  ];

  for (const pass of passes) {
    const result = await scanDir(prisma, serverConfigId, pass.dir, pass.extensions, pass.mediaType, knownPaths, recoverYouTubeTitles);
    added += result.added;
    skipped += result.skipped;
  }

  const healed = recoverYouTubeTitles ? await healYouTubeTitles(prisma, serverConfigId) : 0;

  return { added, skipped, healed };
}
