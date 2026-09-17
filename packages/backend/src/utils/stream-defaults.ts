import type { PrismaClient } from '../generated/prisma/client.js';
import { STREAM_PRESETS, DEFAULT_PRESET } from '../voice/streaming/types.js';

const KEY_PRESET = 'stream_default_preset';
const KEY_FRAMERATE = 'stream_default_framerate';
const KEY_BITRATE = 'stream_default_bitrate';

export interface StreamDefaults {
  preset: string;
  framerate: number;
  bitrate: string;
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
export function builtInStreamDefaults(): StreamDefaults {
  const preset = STREAM_PRESETS[DEFAULT_PRESET];
  return { preset: DEFAULT_PRESET, framerate: preset.framerate, bitrate: preset.bitrate };
}

export async function getStreamDefaults(prisma: PrismaClient): Promise<StreamDefaults> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [KEY_PRESET, KEY_FRAMERATE, KEY_BITRATE] } },
  });
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const fallback = builtInStreamDefaults();

  // A stored preset that no longer exists (renamed or removed in an update)
  // falls back rather than reaching the sidecar as an unknown name.
  const preset = stored.get(KEY_PRESET);
  const framerate = Number(stored.get(KEY_FRAMERATE));

  return {
    preset: preset && preset in STREAM_PRESETS ? preset : fallback.preset,
    framerate: Number.isFinite(framerate) && framerate > 0 ? framerate : fallback.framerate,
    bitrate: stored.get(KEY_BITRATE) || fallback.bitrate,
  };
}

export async function setStreamDefaults(prisma: PrismaClient, values: StreamDefaults): Promise<StreamDefaults> {
  const pairs: Array<[string, string]> = [
    [KEY_PRESET, values.preset],
    [KEY_FRAMERATE, String(values.framerate)],
    [KEY_BITRATE, values.bitrate],
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
