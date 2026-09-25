import fs from 'fs';
import path from 'path';
import { compareVersions, type ComponentVersionStatus, type UpdateCheckResult } from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { getGithubToken } from './github-token.js';
import { AppError } from '../middleware/error-handler.js';

/**
 * Periodically compares this deployment's independently-versioned components
 * (backend, sidecar - frontend reports its own current version client-side
 * and only needs `latest` from here) against what's on GitHub's `main`
 * branch, so the WebUI can show an "update available" notice without the
 * admin needing to remember to check. Notify-only - nothing here ever runs
 * `git pull` or touches Docker; it just reads three small files from a
 * public repo via GitHub's Contents API - authenticated (5000/hour) if a
 * token is configured in Settings, unauthenticated (60/hour) otherwise.
 */

const REPO = 'DomeNinchen/ts6forkmanager';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h - three small GitHub reads per tick
const GITHUB_FETCH_TIMEOUT_MS = 15000;
const SIDECAR_FETCH_TIMEOUT_MS = 5000;

// On-demand rechecks (Settings -> Update Status -> "Recheck Now") only need
// throttling when running unauthenticated: each check costs 3 GitHub
// requests, and the unauthenticated budget is 60/hour total, so 20/hour is
// the most this feature can use on its own without risking exhausting it
// (as happened before this limit existed). With a token configured the
// budget is 5000/hour, more than enough to not need throttling here.
const UNAUTHENTICATED_RECHECK_LIMIT_PER_HOUR = 20;
let recheckTimestamps: number[] = [];

let prismaRef: PrismaClient | null = null;

let cached: UpdateCheckResult = {
  backend: { current: null, latest: null, updateAvailable: false },
  sidecar: { current: null, latest: null, updateAvailable: false },
  frontendLatest: null,
  checkedAt: null,
};

async function fetchWithTimeout(url: string, timeoutMs: number, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ts6forkmanager-update-check', ...extraHeaders },
    });
  } finally {
    clearTimeout(timer);
  }
}

function readOwnVersion(): string | null {
  try {
    const raw = fs.readFileSync(path.resolve('package.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Reads a `"version": "x.y.z"` field out of a package.json on GitHub's main branch. */
async function fetchLatestPackageJsonVersion(repoPath: string, token: string | null): Promise<string | null> {
  try {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetchWithTimeout(`https://api.github.com/repos/${REPO}/contents/${repoPath}?ref=main`, GITHUB_FETCH_TIMEOUT_MS, headers);
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: string };
    if (!body.content) return null;
    const decoded = Buffer.from(body.content, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** The sidecar is a plain Go binary with no package.json - its version lives in a small dedicated const instead (see packages/sidecar/version.go). */
async function fetchLatestSidecarVersion(token: string | null): Promise<string | null> {
  try {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetchWithTimeout(`https://api.github.com/repos/${REPO}/contents/packages/sidecar/version.go?ref=main`, GITHUB_FETCH_TIMEOUT_MS, headers);
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: string };
    if (!body.content) return null;
    const decoded = Buffer.from(body.content, 'base64').toString('utf-8');
    const match = decoded.match(/Version\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Asks the sidecar what it's actually running right now, rather than assuming it matches whatever backend/frontend were last rebuilt with. */
async function fetchRunningSidecarVersion(): Promise<string | null> {
  const sidecarUrl = process.env.SIDECAR_URL;
  if (!sidecarUrl) return null;
  try {
    const res = await fetchWithTimeout(`${sidecarUrl}/version`, SIDECAR_FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

function toStatus(current: string | null, latest: string | null): ComponentVersionStatus {
  return {
    current,
    latest,
    updateAvailable: !!(current && latest && compareVersions(latest, current) > 0),
  };
}

async function runCheck(): Promise<void> {
  const token = prismaRef ? await getGithubToken(prismaRef) : null;
  const [latestBackend, latestFrontend, latestSidecar, runningSidecar] = await Promise.all([
    fetchLatestPackageJsonVersion('packages/backend/package.json', token),
    fetchLatestPackageJsonVersion('packages/frontend/package.json', token),
    fetchLatestSidecarVersion(token),
    fetchRunningSidecarVersion(),
  ]);

  cached = {
    backend: toStatus(readOwnVersion(), latestBackend),
    sidecar: toStatus(runningSidecar, latestSidecar),
    frontendLatest: latestFrontend,
    checkedAt: new Date().toISOString(),
  };
}

export function getCachedUpdateCheck(): UpdateCheckResult {
  return cached;
}

let inFlight: Promise<void> | null = null;

/** On-demand recheck (e.g. a "Recheck now" button in Settings) - reuses an already-running check instead of firing a second one in parallel. */
export async function forceUpdateCheck(): Promise<UpdateCheckResult> {
  const hasToken = !!(prismaRef && (await getGithubToken(prismaRef)));
  if (!hasToken) {
    const now = Date.now();
    recheckTimestamps = recheckTimestamps.filter((t) => now - t < 60 * 60 * 1000);
    if (recheckTimestamps.length >= UNAUTHENTICATED_RECHECK_LIMIT_PER_HOUR) {
      throw new AppError(429, 'Too many recheck requests without a GitHub token configured. Add one in Settings for a much higher limit, or wait before trying again.');
    }
    recheckTimestamps.push(now);
  }

  if (!inFlight) {
    inFlight = runCheck().finally(() => { inFlight = null; });
  }
  await inFlight;
  return cached;
}

export function startUpdateChecker(prisma: PrismaClient): void {
  prismaRef = prisma;
  runCheck().catch(() => {}); // best-effort initial check right at startup
  setInterval(() => {
    runCheck().catch(() => {});
  }, CHECK_INTERVAL_MS);
}
