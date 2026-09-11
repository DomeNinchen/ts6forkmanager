import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getCookieArgs } from '../audio/youtube.js';
import { validateUrl } from '../../utils/url-validator.js';
import { MUSIC_DIR, VIDEO_SUBDIR } from '../audio/media-dirs.js';

/** Temp files we create: `.stream-<digits>.mp4` */
const STREAM_TEMP_NAME = /^\.stream-\d+\.mp4$/;

/** Plain filenames under MUSIC_DIR (no separators / traversal). */
const SAFE_LOCAL_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

function rejectYtDlpOptionUrl(url: string): void {
  if (url.trim().startsWith('-')) {
    throw new Error("Invalid URL: must not start with '-'");
  }
}

function ensureMusicDir(): string {
  const musicRoot = path.resolve(MUSIC_DIR);
  if (!fs.existsSync(musicRoot)) {
    fs.mkdirSync(musicRoot, { recursive: true });
  }
  return fs.realpathSync(musicRoot);
}

function ensureDir(root: string): string {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return fs.realpathSync(resolved);
}

function isUnderRoot(root: string, absolute: string): boolean {
  const relative = path.relative(root, absolute);
  return (
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    !relative.split(path.sep).some((p) => p === '..')
  );
}

/**
 * Try to resolve an already-allowlisted plain filename directly under `root`
 * (one path segment, no further subdirectories), re-checking the allowlist
 * against its realpath to rule out a symlink escape. Returns null (not found
 * / escapes root) rather than throwing, so callers can try multiple roots.
 */
function resolveBasenameUnder(root: string, base: string): string | null {
  const candidate = path.join(root, base);
  if (!fs.existsSync(candidate)) return null;

  const realFile = fs.realpathSync(candidate);
  const realRel = path.relative(root, realFile);
  if (
    realRel.startsWith('..') ||
    path.isAbsolute(realRel) ||
    realRel.split(path.sep).length !== 1
  ) {
    return null;
  }
  const realBase = path.basename(realFile);
  if (!SAFE_LOCAL_BASENAME.test(realBase) && !STREAM_TEMP_NAME.test(realBase)) {
    return null;
  }
  return path.join(root, realBase);
}

/**
 * Map a user-supplied local reference to a path under MUSIC_DIR's video/
 * subfolder (where new video content lives) or, for anything predating that
 * split, MUSIC_DIR's own root - see clusterzx/ts6-manager#33.
 * Only basenames (or a path resolving under one of those two roots) are
 * accepted — never raw absolute paths. The returned path is always
 * `path.join(<trusted root>, basename)` so FS ops are not driven by
 * uncontrolled path expressions (CodeQL path-injection).
 */
export function resolvePathUnderMusicDir(filePath: string): string {
  const musicRoot = ensureMusicDir();
  const videoRoot = ensureDir(path.join(MUSIC_DIR, VIDEO_SUBDIR));
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.includes('\0')) {
    throw new Error('Invalid local video path');
  }

  // Allow either a bare basename or an absolute/relative path whose basename is used.
  // Reject anything whose basename fails the allowlist (blocks `..`, dirs, odd chars).
  const base = path.basename(trimmed);
  if (!SAFE_LOCAL_BASENAME.test(base) && !STREAM_TEMP_NAME.test(base)) {
    throw new Error('Local video path must be a filename under MUSIC_DIR');
  }

  // If the caller passed a path with directories, require it to resolve under
  // one of the two roots before we discard the directory part — prevents
  // surprising basename-only fallback.
  if (trimmed !== base) {
    const absolute = path.resolve(trimmed);
    if (!isUnderRoot(musicRoot, absolute) && !isUnderRoot(videoRoot, absolute)) {
      throw new Error('Local video path must be under MUSIC_DIR');
    }
    if (path.basename(absolute) !== base) {
      throw new Error('Local video path must be under MUSIC_DIR');
    }
  }

  // Prefer video/ (where new content lands), fall back to MUSIC_DIR's own
  // root (files from before the music/video split).
  const resolved = resolveBasenameUnder(videoRoot, base) ?? resolveBasenameUnder(musicRoot, base);
  if (!resolved) {
    throw new Error('Local video file not found');
  }
  return resolved;
}

/** Probe a local media file's duration in seconds, or null if it can't be determined. */
function getVideoDurationSec(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ], { shell: false });

    let stdout = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.on('close', (code) => {
      const seconds = code === 0 ? parseFloat(stdout.trim()) : NaN;
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
    proc.on('error', () => resolve(null));
  });
}

function isYtDlpStreamHost(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com') ||
    hostname === 'youtu.be' ||
    hostname === 'twitch.tv' ||
    hostname.endsWith('.twitch.tv')
  );
}

/**
 * Download on-demand video via yt-dlp to a temp file under MUSIC_DIR, then
 * stream from disk. This avoids feeding ffmpeg a live googlevideo CDN URL:
 * those are frequently rate-limited/403'd when fetched from a datacenter IP,
 * and modern YouTube rarely offers a genuine combined (video+audio) format
 * above 360p at all -- bv*+ba lets yt-dlp merge real DASH tracks up front,
 * once, instead of us reimplementing that live.
 *
 * Ported from uniskela/ts6-manager (github.com/uniskela/ts6-manager), whose
 * own header credits it as "Adapted from uniplayer1/ts6-manager".
 */
export interface DownloadedStream {
  path: string;
  /** Only set for a freshly downloaded temp file; used to auto-stop the stream when it ends. */
  durationSec: number | null;
}

export async function downloadVideoForStream(
  url: string,
  maxHeight: number = 720,
  maxDurationSec: number = 900,
): Promise<DownloadedStream> {
  rejectYtDlpOptionUrl(url);

  // yt-dlp's own search syntax (e.g. "ytsearch1:some title") - not a network
  // URL, so it skips the SSRF host check below (there's no attacker-chosen
  // host to validate, yt-dlp resolves it via YouTube's own search) and always
  // goes through yt-dlp rather than the direct-stream or local-file branches.
  const isSearchQuery = url.startsWith('ytsearch');
  const isRemote =
    isSearchQuery ||
    url.startsWith('http://') ||
    url.startsWith('https://');

  if (!isRemote) {
    return { path: resolvePathUnderMusicDir(url), durationSec: null };
  }

  if (!isSearchQuery) {
    const check = await validateUrl(url, { allowedProtocols: ['http:', 'https:'] });
    if (!check.valid) {
      throw new Error(`Video source blocked: ${check.error}`);
    }

    if (!isYtDlpStreamHost(url)) {
      return { path: url, durationSec: null };
    }
  }

  const musicRoot = ensureMusicDir();
  const formatFilter = `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]/b`;
  // Name is fully server-controlled; join to trusted root only.
  const tempName = `.stream-${Date.now()}.mp4`;
  const tempPath = path.join(musicRoot, tempName);

  await new Promise<void>((resolve, reject) => {
    const args = [
      ...getCookieArgs(),
      '-f', formatFilter,
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--no-progress',
      '-o', tempPath,
      '--match-filter', maxDurationSec > 0 ? `duration <= ${maxDurationSec}` : 'duration >= 0',
      '--',
      url,
    ];

    const proc = spawn('yt-dlp', args, { shell: false });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Video download timed out after 10 minutes'));
    }, 10 * 60_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(-2000)}`));
        return;
      }
      resolve();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`yt-dlp not found: ${err.message}`));
    });
  });

  // Re-resolve via allowlisted basename (tempName is server-generated).
  const canonicalTemp = resolvePathUnderMusicDir(tempName);
  const durationSec = await getVideoDurationSec(canonicalTemp);
  console.log(`[VideoDownload] Downloaded: ${canonicalTemp} (${fs.statSync(canonicalTemp).size} bytes, ${durationSec ?? 'unknown'}s)`);
  return { path: canonicalTemp, durationSec };
}

/**
 * Unlink a `.stream-*.mp4` temp file.
 * Path for unlink is always `join(MUSIC_DIR, allowlistedBasename)` — never the raw input.
 */
export function safeUnlinkStreamTemp(filePath: string): void {
  try {
    const musicRoot = ensureMusicDir();
    const base = path.basename(filePath.trim());
    if (!STREAM_TEMP_NAME.test(base)) return;
    const safePath = path.join(musicRoot, base);
    fs.unlinkSync(safePath);
  } catch {
    /* ignore missing/invalid paths */
  }
}

/** Remove orphaned .stream-*.mp4 temp files from prior runs. */
export function sweepStreamTempFiles(): void {
  try {
    const musicRoot = ensureMusicDir();
    for (const name of fs.readdirSync(musicRoot)) {
      if (!STREAM_TEMP_NAME.test(name)) continue;
      try {
        // name comes from readdir of trusted root; still unlink via join + allowlist.
        const safePath = path.join(musicRoot, name);
        fs.unlinkSync(safePath);
        console.log(`[VideoDownload] Swept orphan stream file: ${name}`);
      } catch { /* ignore */ }
    }
  } catch (err: any) {
    console.warn(`[VideoDownload] Sweep failed: ${err.message}`);
  }
}
