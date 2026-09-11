import type { PrismaClient } from '../generated/prisma/client.js';

export type DebugFlagName = 'voice' | 'rankCheck';

const ENV_VAR_MAP: Record<DebugFlagName, string> = {
  voice: 'VOICE_DEBUG',
  rankCheck: 'RANK_CHECK_DEBUG',
};

const DB_KEY_MAP: Record<DebugFlagName, string> = {
  voice: 'debug_voice',
  rankCheck: 'debug_rank_check',
};

const cache: Record<DebugFlagName, boolean> = {
  voice: false,
  rankCheck: false,
};

/**
 * Loads persisted debug-flag settings into an in-memory cache so hot paths
 * (e.g. per-packet voice debug logging, per-client rank check logging) can
 * check a plain boolean instead of hitting the DB every time. Called once at
 * startup. A flag with no DB row yet falls back to its legacy env var, so
 * existing deployments don't silently lose a flag they already had set.
 */
export async function loadDebugFlags(prisma: PrismaClient): Promise<void> {
  for (const name of Object.keys(DB_KEY_MAP) as DebugFlagName[]) {
    const row = await prisma.appSetting.findUnique({ where: { key: DB_KEY_MAP[name] } });
    cache[name] = row ? row.value === 'true' : process.env[ENV_VAR_MAP[name]] === '1';
  }
}

export function isDebugEnabled(name: DebugFlagName): boolean {
  return cache[name];
}

export function getDebugFlags(): Record<DebugFlagName, boolean> {
  return { ...cache };
}

export async function setDebugFlag(prisma: PrismaClient, name: DebugFlagName, enabled: boolean): Promise<void> {
  cache[name] = enabled;
  await prisma.appSetting.upsert({
    where: { key: DB_KEY_MAP[name] },
    create: { key: DB_KEY_MAP[name], value: String(enabled) },
    update: { value: String(enabled) },
  });
}
