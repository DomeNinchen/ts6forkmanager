// How the change-log middleware reads a request's URL: which area it belongs to,
// what the target ids are, whether it is security-critical (fail-closed), and
// whether it is logged at all. Kept apart from the middleware so the route
// completeness test (change-log.policy.test.ts) can check the same rules: a new
// writing route whose area is not known here makes that test fail, the way a new
// route is admin-only until it is opened (see access-policy.ts). The URL shapes
// are fixed by app.ts (/api/servers/:configId/vs/:sid/<area>/..., etc.).

import type { UiChangeMethod } from '@ts6/common';
import { UI_CHANGE_METHODS } from '@ts6/common';

export interface ChangeTarget {
  area: string;
  /** The path with ids named, never the raw URL (e.g. "/servers/:configId/vs/:sid/channels/:id"). */
  routePattern: string;
  serverConfigId: number | null;
  virtualServerId: number | null;
  targetId: string | null;
  /** Fail-closed: the change is refused if its "pending" row cannot be written first. */
  critical: boolean;
}

export type ChangeDecision =
  | { kind: 'log'; target: ChangeTarget }
  | { kind: 'skip'; reason: 'not-mutating' | 'not-api' | 'excluded' };

/**
 * Areas whose changes are written before they run and refused if that write
 * fails (decision: fail-closed only for the security-critical, everything else
 * is logged after the fact). The admin's own accounts and access, the server
 * connections and their stored credentials, the instance-wide settings, and the
 * app's own settings (which carry the SSO secret and the security switches).
 */
export const CRITICAL_AREAS: ReadonlySet<string> = new Set(['users', 'servers', 'instance', 'settings', 'backups']);

/**
 * Every area the middleware logs. A writing route whose area is not in here
 * fails the completeness test, so adding one forces a conscious decision about
 * logging it (and whether it is critical). The server-scoped areas come from the
 * mounts in app.ts; the rest are the top-level mounts.
 */
export const KNOWN_AREAS: ReadonlySet<string> = new Set([
  // under /servers/:configId/vs/:sid/
  'channels', 'clients', 'server-groups', 'channel-groups', 'permissions', 'bans', 'tokens',
  'files', 'icons', 'complaints', 'messages', 'logs', 'dashboard', 'statistics',
  // under /servers/:configId/
  'virtual-servers', 'console', 'instance', 'command-permissions', 'music-library', 'radio-stations', 'music-requests',
  // the connection itself (add, edit, delete, identity, bot-identity, global message)
  'servers',
  // top-level mounts
  'users', 'settings', 'bots', 'music-bots', 'playlists', 'widgets', 'connection-journal', 'change-log',
  // database backups: they hold password hashes and encrypted credentials
  'backups',
  // a user's own account: password, 2FA, language (signing in and out is excluded below)
  'auth',
]);

/** Signing in and out: the connection journal records those, so they stay out of the change log. */
const AUTH_SESSION_ROUTES: ReadonlySet<string> = new Set(['login', 'login/verify-totp', 'refresh', 'logout']);

/** The segment right after /servers/:configId that is its own area rather than a sub-resource of the connection. */
const SERVER_SCOPED: ReadonlySet<string> = new Set([
  'virtual-servers', 'console', 'instance', 'command-permissions', 'music-library', 'radio-stations', 'music-requests',
]);

const MUTATING = new Set<string>(UI_CHANGE_METHODS);

function isMutating(method: string): method is UiChangeMethod {
  return MUTATING.has(method);
}

/** A whole-number path segment is an object id; a word (a sub-action like `enable` or a settings key) is not. */
function isId(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/**
 * Path parameters whose value is a secret: the key of a privilege key, a temporary server
 * password. The body masking cannot see them, so their position is named here and the value
 * never reaches the row (pattern, target id, or the TeamSpeak log line). The completeness test
 * fails when a route gains a parameter with a secret-sounding name that this list misses.
 */
export const SECRET_PATH_PARAMS: ReadonlyArray<{ method: UiChangeMethod; area: string; leaf: readonly string[] }> = [
  { method: 'DELETE', area: 'tokens', leaf: [':token'] },
  { method: 'DELETE', area: 'tokens', leaf: ['temp-passwords', ':pw'] },
];

/**
 * The pattern and target id of the segments below a mount: ids become ":id", words stay as
 * they are, and a secret parameter becomes its name.
 */
function leafOf(method: UiChangeMethod, area: string, leaf: string[]): { pattern: string; targetId: string | null } {
  const secret = SECRET_PATH_PARAMS.find((s) =>
    s.method === method && s.area === area && s.leaf.length === leaf.length && s.leaf.every((p, i) => p.startsWith(':') || p === leaf[i]));
  const shown = leaf.map((s, i) => (secret?.leaf[i].startsWith(':') ? secret.leaf[i] : s));
  return {
    pattern: shown.map((s) => `/${isId(s) ? ':id' : s}`).join(''),
    targetId: shown.find(isId) ?? null,
  };
}

/** The handful of writing routes that are deliberately not logged (decision 2). */
function isExcluded(method: UiChangeMethod, rest: string[]): boolean {
  const area = rest[0];
  // A user's own dashboard settings; a forced update re-check; the yt-dlp cookie check - none is a change to the server or to other users.
  if (area === 'user-settings' || area === 'update-check' || area === 'yt-cookie-check') return true;
  if (area === 'auth' && AUTH_SESSION_ROUTES.has(rest.slice(1).join('/'))) return true;
  // POST /api/servers/:configId/test only tests a connection, it changes nothing.
  if (area === 'servers' && rest.length === 3 && rest[2] === 'test' && method === 'POST') return true;
  return false;
}

/**
 * What to do with a request, from its method and original path (with the /api
 * prefix, no query string). The middleware logs `kind: 'log'` and ignores the rest.
 */
export function classifyChange(method: string, path: string): ChangeDecision {
  if (!isMutating(method)) return { kind: 'skip', reason: 'not-mutating' };

  const segments = path.split('?')[0].split('/').filter(Boolean);
  if (segments[0] !== 'api' || segments.length < 2) return { kind: 'skip', reason: 'not-api' };
  const rest = segments.slice(1);

  if (isExcluded(method, rest)) return { kind: 'skip', reason: 'excluded' };

  const critical = (area: string) => CRITICAL_AREAS.has(area);

  if (rest[0] === 'servers') {
    if (rest.length === 1) {
      return { kind: 'log', target: { area: 'servers', routePattern: '/servers', serverConfigId: null, virtualServerId: null, targetId: null, critical: true } };
    }
    const serverConfigId = isId(rest[1]) ? Number(rest[1]) : null;
    const after = rest.slice(2);
    if (after.length === 0) {
      // /api/servers/:configId - edit or delete the connection itself.
      return { kind: 'log', target: { area: 'servers', routePattern: '/servers/:configId', serverConfigId, virtualServerId: null, targetId: rest[1], critical: true } };
    }
    if (after[0] === 'vs') {
      const virtualServerId = isId(after[1]) ? Number(after[1]) : null;
      const area = after[2] ?? 'vs';
      const { pattern, targetId } = leafOf(method, area, after.slice(3));
      return { kind: 'log', target: { area, routePattern: `/servers/:configId/vs/:sid/${area}${pattern}`, serverConfigId, virtualServerId, targetId, critical: critical(area) } };
    }
    if (SERVER_SCOPED.has(after[0])) {
      const area = after[0];
      const { pattern, targetId } = leafOf(method, area, after.slice(1));
      return { kind: 'log', target: { area, routePattern: `/servers/:configId/${area}${pattern}`, serverConfigId, virtualServerId: null, targetId, critical: critical(area) } };
    }
    // A sub-resource of the connection (identity, bot-identity, global-message).
    return { kind: 'log', target: { area: 'servers', routePattern: `/servers/:configId${leafOf(method, 'servers', after).pattern}`, serverConfigId, virtualServerId: null, targetId: null, critical: true } };
  }

  const area = rest[0];
  const { pattern, targetId } = leafOf(method, area, rest.slice(1));
  return { kind: 'log', target: { area, routePattern: `/${area}${pattern}`, serverConfigId: null, virtualServerId: null, targetId, critical: critical(area) } };
}
