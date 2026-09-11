import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { PrismaClient } from '../../generated/prisma/client.js';

const MUSIC_DIR = process.env.MUSIC_DIR || '/data/music';
const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac', '.wma', '.webm'];

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

/**
 * Scan MUSIC_DIR for audio files not yet tracked as a Song for this server
 * config (e.g. dropped in directly, or shared with another app like Plex -
 * see clusterzx/ts6-manager#79) and add them. Same title/artist parsing and
 * duration extraction as the manual upload handler.
 */
export async function scanMusicLibrary(prisma: PrismaClient, serverConfigId: number): Promise<{ added: number; skipped: number }> {
  if (!fs.existsSync(MUSIC_DIR)) return { added: 0, skipped: 0 };

  const existing = await prisma.song.findMany({
    where: { serverConfigId },
    select: { filePath: true },
  });
  const knownPaths = new Set(existing.map((s: { filePath: string }) => s.filePath));

  const entries = fs.readdirSync(MUSIC_DIR, { withFileTypes: true });
  let added = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Dotfiles include our own temp video-stream downloads (.stream-<ts>.mp4) - never library content.
    if (entry.name.startsWith('.')) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) continue;

    const filePath = path.join(MUSIC_DIR, entry.name);
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
        fileSize: stat.size,
        serverConfigId,
      },
    });
    added++;
  }

  return { added, skipped };
}
