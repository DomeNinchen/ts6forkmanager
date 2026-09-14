import { checkCookiesValid, getYtCookieFile } from '../voice/audio/youtube.js';

/**
 * Periodically re-validates the configured YouTube cookie file against
 * YouTube itself (see checkCookiesValid), so the WebUI can show a proactive
 * "cookies stopped working" notice instead of an admin only finding out via
 * a failed !play in front of everyone. Mirrors update-check.ts's shape.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h, same cadence as update-check - a real yt-dlp/YouTube round trip, not free

export interface YtCookieCheckResult {
  /** null = no cookie file configured at all (not a problem to flag - the feature just isn't in use) */
  valid: boolean | null;
  checkedAt: string | null;
}

let cached: YtCookieCheckResult = { valid: null, checkedAt: null };

async function runCheck(): Promise<void> {
  if (!getYtCookieFile()) {
    cached = { valid: null, checkedAt: new Date().toISOString() };
    return;
  }
  const valid = await checkCookiesValid();
  cached = { valid, checkedAt: new Date().toISOString() };
}

export function getCachedCookieCheck(): YtCookieCheckResult {
  return cached;
}

let inFlight: Promise<void> | null = null;

/** On-demand recheck - reuses an already-running check instead of firing a second one in parallel. */
export async function forceCookieCheck(): Promise<YtCookieCheckResult> {
  if (!inFlight) {
    inFlight = runCheck().finally(() => { inFlight = null; });
  }
  await inFlight;
  return cached;
}

export function startYtCookieChecker(): void {
  runCheck().catch(() => {}); // best-effort initial check right at startup
  setInterval(() => {
    runCheck().catch(() => {});
  }, CHECK_INTERVAL_MS);
}
