import fs from 'fs';
import path from 'path';

export const MUSIC_DIR = process.env.MUSIC_DIR || '/data/music';

// New uploads/downloads are organized into these subfolders; files sitting
// directly in MUSIC_DIR (from before this split existed) are still picked up
// by scan/resolve for backward compatibility - see clusterzx/ts6-manager#33.
export const AUDIO_SUBDIR = 'music';
export const VIDEO_SUBDIR = 'video';

export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.opus', '.m4a', '.aac', '.wma', '.webm'];
export const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'];

export const AUDIO_DIR = path.join(MUSIC_DIR, AUDIO_SUBDIR);
export const VIDEO_DIR = path.join(MUSIC_DIR, VIDEO_SUBDIR);

for (const dir of [MUSIC_DIR, AUDIO_DIR, VIDEO_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
