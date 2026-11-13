import { spawn } from 'child_process';
import { AppError } from '../../middleware/error-handler.js';
import { validateUrl } from '../../utils/url-validator.js';
import { getCookieArgs } from './youtube.js';
import { BYTES_PER_FRAME, FRAME_MS } from './pipeline.js';

/**
 * Twitch offers an `audio_only` rendition; other live sources (YouTube Live) only have
 * muxed HLS, so the smallest one with sound is taken - ffmpeg drops the picture anyway.
 */
export const LIVE_AUDIO_FORMAT = 'audio_only/bestaudio/worst';
/** Re-resolves of the stream address after it broke off, before the bot gives up. */
export const LIVE_MAX_RETRIES = 3;
/** A live stream that played this long counts as healthy again: the next drop starts the retry count over. */
export const LIVE_STABLE_MS = 60_000;
/** No sound from ffmpeg for this long (a playlist that stopped growing) counts as a dropped stream. */
export const LIVE_STALL_MS = 20_000;
/** After the buffer ran dry, sound to collect before playing on: one longer pause beats a gap every few seconds. */
export const LIVE_REBUFFER_MS = 5_000;
export const LIVE_REBUFFER_BYTES = (LIVE_REBUFFER_MS / FRAME_MS) * BYTES_PER_FRAME;
const RESOLVE_TIMEOUT_MS = 45_000;

/** 2 s, 4 s, 8 s: long enough for a broadcaster's short reconnect, short enough to sound like a hiccup. */
export function liveRetryDelayMs(attempt: number): number {
  return 1000 * 2 ** Math.max(1, Math.min(attempt, LIVE_MAX_RETRIES));
}

export type YtDlpErrorKind = 'offline' | 'age' | 'login' | 'not_found' | 'unknown';

/** Sorts yt-dlp's stderr into the cases a user can do something about. Age comes before login: YouTube words it "Sign in to confirm your age". */
export function classifyYtDlpError(stderr: string): YtDlpErrorKind {
  const s = stderr.toLowerCase();
  if (s.includes('not currently live') || s.includes('is offline') || s.includes('live event will begin')) return 'offline';
  if (s.includes('confirm your age') || s.includes('age-restricted') || s.includes('age restricted')) return 'age';
  if (s.includes('logged into') || s.includes('sign in') || s.includes('login required') || s.includes('subscriber-only') || s.includes('members-only') || s.includes('--cookies')) return 'login';
  if (s.includes('does not exist') || s.includes('not found') || s.includes('http error 404')) return 'not_found';
  return 'unknown';
}

/** A readable 400 for the known cases; null for 'unknown' so the caller keeps its own message. */
export function ytDlpErrorToAppError(kind: YtDlpErrorKind): AppError | null {
  switch (kind) {
    case 'offline': return new AppError(400, 'The channel is not live right now', undefined, 'LIVE_OFFLINE');
    case 'age': return new AppError(400, 'This stream is age-restricted - an admin can add a signed-in cookie file under Settings -> Music', undefined, 'SOURCE_AGE_RESTRICTED');
    case 'login': return new AppError(400, 'This stream needs a signed-in account (subscribers or members only) - an admin can add a cookie file under Settings -> Music', undefined, 'SOURCE_LOGIN_REQUIRED');
    case 'not_found': return new AppError(400, 'This channel or video does not exist', undefined, 'SOURCE_NOT_FOUND');
    default: return null;
  }
}

export interface LiveAudioSource {
  isLive: boolean;
  /** Direct media address (HLS playlist); signed and short-lived on Twitch, so it is fetched again on every (re)start. */
  url: string;
  /** Set when the page serves picture and sound separately (YouTube live): the sound's own address. */
  audioUrl?: string;
}

/** Reads the `--print` output below (is_live, then one URL per selected format); null when yt-dlp printed something else. */
export function parseLivePrint(stdout: string): LiveAudioSource | null {
  const [isLive, ...rest] = stdout.trim().split('\n').map((l) => l.trim());
  const urls = rest.filter((l) => /^https?:\/\//.test(l));
  if (urls.length === 0 || urls.length !== rest.length) return null;
  return { isLive: isLive === 'True', url: urls[0], ...(urls[1] ? { audioUrl: urls[1] } : {}) };
}

/** Video: one muxed format up to the preset height (Twitch), else separate picture + sound (YouTube live). */
export function liveVideoFormat(maxHeight: number): string {
  // YouTube live has no muxed format: picture and sound then come as two addresses
  return `best[height<=${maxHeight}]/bv*[height<=${maxHeight}]+ba/best`;
}

/** Longest a Twitch ad break holds the picture back; past it the playlist is played as it is. */
export const LIVE_AD_HOLD_MS = 4 * 60_000;

/** Twitch stitches ads into the live playlist: its own segments are titled "live", ad segments are not. */
export function playlistHasAd(m3u8: string): boolean {
  return m3u8.split('\n').some((l) => l.startsWith('#EXTINF') && !/^#EXTINF:[^,]*,live$/.test(l.trim()));
}

/**
 * Whether an ad break is in a Twitch media playlist right now; null for other sources or when it
 * could not be read. The address already passed resolveLive's SSRF check.
 */
export async function twitchAdRunning(mediaUrl: string): Promise<boolean | null> {
  try {
    if (!new URL(mediaUrl).hostname.endsWith('.ttvnw.net')) return null;
    const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(5_000), redirect: 'error' });
    return res.ok ? playlistHasAd(await res.text()) : null;
  } catch {
    return null;
  }
}

/** Asks yt-dlp whether a page is live right now and for its current media address in `format`. */
export async function resolveLive(pageUrl: string, format: string): Promise<LiveAudioSource> {
  if (pageUrl.trim().startsWith('-')) throw new AppError(400, "Invalid URL: must not start with '-'");
  const check = await validateUrl(pageUrl, { allowedProtocols: ['http:', 'https:'] });
  if (!check.valid) throw new AppError(400, 'This URL is not allowed - only public http(s) addresses can be loaded');

  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      ...getCookieArgs(), '--no-playlist', '--no-warnings', '-f', format,
      '--print', '%(is_live)s', '--print', 'urls', '--', pageUrl,
    ], { shell: false });
    let out = '';
    let err = '';
    proc.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    proc.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Looking up the live stream timed out')); }, RESOLVE_TIMEOUT_MS);
    proc.on('close', (c) => { clearTimeout(timer); resolve({ stdout: out, stderr: err, code: c }); });
    proc.on('error', (e) => { clearTimeout(timer); reject(new Error(`yt-dlp not found: ${e.message}`)); });
  });

  if (code !== 0) {
    const known = ytDlpErrorToAppError(classifyYtDlpError(stderr));
    if (known) throw known;
    // stderr can name internal addresses and ends up in TeamSpeak chat via the caller: log it, keep the message plain
    console.warn(`[LiveSource] yt-dlp failed (code ${code}): ${stderr.trim().slice(-500)}`);
    throw new Error('The live stream could not be loaded');
  }
  const parsed = parseLivePrint(stdout);
  if (!parsed) throw new Error('yt-dlp returned no stream address');
  // The media address is a second hop chosen by the extractor: it gets the same SSRF check as the page
  for (const u of [parsed.url, parsed.audioUrl]) {
    if (!u) continue;
    const media = await validateUrl(u, { allowedProtocols: ['http:', 'https:'] });
    if (!media.valid) throw new AppError(400, 'The stream address this page points to is not allowed');
  }
  return parsed;
}

/** The current audio address of a live page (Twitch channel, YouTube live...). */
export async function resolveLiveAudio(pageUrl: string): Promise<string> {
  const live = await resolveLive(pageUrl, LIVE_AUDIO_FORMAT);
  // Was live when queued, a finished broadcast now: that is the channel going offline
  if (!live.isLive) throw ytDlpErrorToAppError('offline')!;
  return live.url;
}

/** How often the title and preview picture of a running live stream are looked up again. */
export const LIVE_INFO_REFRESH_MS = 5 * 60_000;

export interface LiveInfo {
  /** What the broadcaster calls the stream right now. */
  title: string;
  /** The channel. */
  artist: string;
  /** Preview picture address on the platform's CDN; empty when it has none. */
  thumbnail: string;
}

/**
 * The stream's own title from yt-dlp's info. Twitch's `title` is always "<channel> (live) <date>",
 * its stream title is the description; elsewhere `fulltitle` is the title without the date
 * yt-dlp appends to live titles.
 */
export function liveDisplayInfo(j: Record<string, any>): LiveInfo {
  const plain = String(j.fulltitle || j.title || '').replace(/ \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '').trim();
  const twitchTitle = j.extractor_key === 'TwitchStream' ? String(j.description || '').trim() : '';
  return {
    title: twitchTitle || plain || 'Live stream',
    artist: String(j.uploader || j.channel || '').trim() || 'Live',
    thumbnail: typeof j.thumbnail === 'string' && /^https?:\/\//.test(j.thumbnail) ? j.thumbnail : '',
  };
}

/** Current title, channel and preview picture of a live page; null when it could not be read or is not live. */
export async function fetchLiveInfo(pageUrl: string): Promise<LiveInfo | null> {
  if (pageUrl.trim().startsWith('-')) return null;
  const check = await validateUrl(pageUrl, { allowedProtocols: ['http:', 'https:'] });
  if (!check.valid) return null;
  const out = await new Promise<string | null>((resolve) => {
    // No format is needed for the info; YouTube live refuses some format choices outright
    const proc = spawn('yt-dlp', [
      ...getCookieArgs(), '--no-playlist', '--no-warnings', '--ignore-no-formats-error', '--dump-json', '--', pageUrl,
    ], { shell: false });
    let stdout = '';
    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr.on('data', () => { /* offline or a hiccup: the playback's own retries deal with that */ });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(null); }, RESOLVE_TIMEOUT_MS);
    proc.on('close', (c) => { clearTimeout(timer); resolve(c === 0 ? stdout : null); });
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
  });
  if (!out) return null;
  try {
    const j = JSON.parse(out);
    return j.is_live ? liveDisplayInfo(j) : null;
  } catch {
    return null;
  }
}
