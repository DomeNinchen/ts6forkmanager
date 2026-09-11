import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { MUSIC_DIR, AUDIO_DIR, VIDEO_DIR, AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from './media-dirs.js';

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

async function scanDir(
  prisma: PrismaClient,
  serverConfigId: number,
  dir: string,
  extensions: string[],
  mediaType: 'audio' | 'video',
  knownPaths: Set<string>,
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

    let duration: number | null = null;
    try {
      duration = await getAudioDuration(filePath);
    } catch { /* ignore duration extraction failure */ }

    const baseName = path.basename(entry.name, ext);
    let title = baseName;
    let artist: string | null = null;
    const dashIdx = baseName.indexOf(' - ');
    if (dashIdx > 0) {
      artist = baseName.substring(0, dashIdx).trim();
      title = baseName.substring(dashIdx + 3).trim();
    }

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
 * Scan for audio/video files not yet tracked as a Song for this server config
 * and add them. Covers the organized `music/`/`video/` subfolders (where new
 * uploads/downloads land) plus MUSIC_DIR's own root, for files that were
 * already there before the subfolder split (or dropped in directly, e.g. a
 * volume shared with another app) - see clusterzx/ts6-manager#79 and #33.
 * Same title/artist parsing and duration extraction as the manual upload handler.
 */
export async function scanMusicLibrary(prisma: PrismaClient, serverConfigId: number): Promise<{ added: number; skipped: number }> {
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
    const result = await scanDir(prisma, serverConfigId, pass.dir, pass.extensions, pass.mediaType, knownPaths);
    added += result.added;
    skipped += result.skipped;
  }

  return { added, skipped };
}
