import type { PrismaClient } from '../generated/prisma/client.js';

export interface ScheduledRestartConfig {
  backendEnabled: boolean;
  sidecarEnabled: boolean;
  /** 24h "HH:MM", local server time. */
  time: string;
  /** 0=Sunday .. 6=Saturday. */
  days: number[];
}

const DB_KEY = 'scheduled_restart_config';

const DEFAULT_CONFIG: ScheduledRestartConfig = {
  backendEnabled: false,
  sidecarEnabled: false,
  time: '04:00',
  days: [0, 1, 2, 3, 4, 5, 6],
};

export async function getScheduledRestartConfig(prisma: PrismaClient): Promise<ScheduledRestartConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: DB_KEY } });
  if (!row) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function setScheduledRestartConfig(prisma: PrismaClient, config: ScheduledRestartConfig): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: DB_KEY },
    create: { key: DB_KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });
}

const CHECK_INTERVAL_MS = 30_000;

/**
 * Polls the configured restart schedule and, once per matching day, restarts
 * the backend (self SIGTERM - relies on the container's `restart:
 * unless-stopped` policy) and/or the sidecar (POST its own /restart, same
 * mechanism) - see clusterzx/ts6-manager#55. Each is independently
 * opt-in; a container some admin's setup doesn't use (e.g. no sidecar) is
 * simply never restarted.
 *
 * The automatic startup scan pattern used elsewhere in this codebase reads
 * config once; this instead re-reads it every tick so a change takes effect
 * without needing a restart of its own to pick up.
 */
export function startScheduledRestartChecker(prisma: PrismaClient): void {
  let lastFiredDate: string | null = null;

  setInterval(async () => {
    let config: ScheduledRestartConfig;
    try {
      config = await getScheduledRestartConfig(prisma);
    } catch {
      return; // DB hiccup - just try again next tick
    }
    if (!config.backendEnabled && !config.sidecarEnabled) return;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (todayStr === lastFiredDate) return;
    if (!config.days.includes(now.getDay())) return;

    const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (nowHHMM !== config.time) return;

    lastFiredDate = todayStr; // claim this day before doing anything async

    if (config.sidecarEnabled && process.env.SIDECAR_URL) {
      console.log('[ScheduledRestart] Restarting sidecar');
      fetch(`${process.env.SIDECAR_URL}/restart`, { method: 'POST' }).catch((err) => {
        console.warn(`[ScheduledRestart] Sidecar restart request failed: ${err.message}`);
      });
    }

    if (config.backendEnabled) {
      console.log('[ScheduledRestart] Restarting backend');
      // Give the sidecar request above a moment to actually go out first.
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500);
    }
  }, CHECK_INTERVAL_MS);
}
