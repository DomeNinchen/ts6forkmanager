import type { PrismaClient } from '../generated/prisma/client.js';
import { STREAM_PRESETS, DEFAULT_PRESET } from '../voice/streaming/types.js';

const KEY_PRESET = 'stream_default_preset';
const KEY_FRAMERATE = 'stream_default_framerate';
const KEY_BITRATE = 'stream_default_bitrate';
const KEY_VOLUME = 'stream_default_volume';
const KEY_IDLE_STOP = 'stream_idle_stop_minutes';

/** A day is more than any "nobody is watching" patience makes sense for; it also keeps setTimeout well inside its range. */
export const IDLE_STOP_MAX_MINUTES = 1440;

export interface StreamDefaults {
  preset: string;
  framerate: number;
  bitrate: string;
  /** Percent applied to the source's own audio level; 100 leaves it alone. */
  volume: number;
  /**
   * How many minutes a video stream may run with nobody watching before the bot
   * ends it; 0 keeps it running until someone stops it, which is how it always
   * behaved. Unlike the other fields this is no default for `!stream`, it is a
   * rule for a stream that is already running - it sits here because the
   * Streaming tab is where an admin looks for everything about video.
   */
  idleStopMinutes: number;
}

/**
 * What `!stream <url>` uses when the person typing it doesn't name a preset.
 *
 * The values that ship with the app suit a reasonably fast connection, which
 * is not everyone's - so they are only the starting point, and an admin can
 * move them in Settings -> Streaming. Resolution still comes from a preset
 * (the sidecar needs a concrete width and height, and the same three names
 * are what `!stream <url> 720p` accepts), but frame rate and bitrate are free
 * values, because those are what you actually want to trade away when the
 * upstream is the bottleneck.
 *
 * Note this is deliberately global rather than per-bot: the limiting factor is
 * the machine's upstream bandwidth and CPU, which every bot on it shares.
 */
/**
 * Volume is deliberately low. A video carries whatever loudness its creator
 * mastered it at, which is routinely far above the level people speak at in a
 * TeamSpeak channel - so a stream at its own level arrives as a shout. Viewers
 * can always turn their own player up; they cannot turn down something that is
 * already clipping their ears.
 */
const BUILT_IN_VOLUME = 10;

export function builtInStreamDefaults(): StreamDefaults {
  const preset = STREAM_PRESETS[DEFAULT_PRESET];
  return {
    preset: DEFAULT_PRESET,
    framerate: preset.framerate,
    bitrate: preset.bitrate,
    volume: BUILT_IN_VOLUME,
    // Off: switching it on is a decision about the server's bandwidth, and a
    // stream that ends by itself is a surprise nobody asked for.
    idleStopMinutes: 0,
  };
}

export async function getStreamDefaults(prisma: PrismaClient): Promise<StreamDefaults> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [KEY_PRESET, KEY_FRAMERATE, KEY_BITRATE, KEY_VOLUME, KEY_IDLE_STOP] } },
  });
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const fallback = builtInStreamDefaults();

  // A stored preset that no longer exists (renamed or removed in an update)
  // falls back rather than reaching the sidecar as an unknown name.
  const preset = stored.get(KEY_PRESET);
  const framerate = Number(stored.get(KEY_FRAMERATE));
  // 0 is a real choice here (mute), so this checks for a stored value rather
  // than falling back on anything falsy the way the others can.
  const storedVolume = stored.get(KEY_VOLUME);
  const volume = storedVolume === undefined ? NaN : Number(storedVolume);
  const storedIdleStop = stored.get(KEY_IDLE_STOP);
  const idleStopMinutes = storedIdleStop === undefined ? NaN : Number(storedIdleStop);

  return {
    preset: preset && preset in STREAM_PRESETS ? preset : fallback.preset,
    framerate: Number.isFinite(framerate) && framerate > 0 ? framerate : fallback.framerate,
    bitrate: stored.get(KEY_BITRATE) || fallback.bitrate,
    volume: Number.isFinite(volume) && volume >= 0 && volume <= 100 ? volume : fallback.volume,
    idleStopMinutes:
      Number.isInteger(idleStopMinutes) && idleStopMinutes >= 0 && idleStopMinutes <= IDLE_STOP_MAX_MINUTES
        ? idleStopMinutes
        : fallback.idleStopMinutes,
  };
}

export async function setStreamDefaults(prisma: PrismaClient, values: StreamDefaults): Promise<StreamDefaults> {
  const pairs: Array<[string, string]> = [
    [KEY_PRESET, values.preset],
    [KEY_FRAMERATE, String(values.framerate)],
    [KEY_BITRATE, values.bitrate],
    [KEY_VOLUME, String(values.volume)],
    [KEY_IDLE_STOP, String(values.idleStopMinutes)],
  ];
  await prisma.$transaction(
    pairs.map(([key, value]) =>
      prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } }),
    ),
  );
  return values;
}

/** Bitrates are written the way ffmpeg wants them, e.g. `6000k` or `2M`. */
export const BITRATE_PATTERN = /^\d{1,6}(k|K|m|M)?$/;
