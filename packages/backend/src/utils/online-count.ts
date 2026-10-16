import {
  ONLINE_COUNT_FILTER_DEFAULT,
  ONLINE_COUNT_MAX_GROUPS,
  type OnlineCountFilter,
  type OnlineCountScope,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import { commaListHasExact } from './group-match.js';

/** One AppSetting row per virtual server and scope; a server with no row counts everybody. */
const keyFor = (configId: number, sid: number, scope: OnlineCountScope) => `online_count_filter:${configId}:${sid}:${scope}`;

/** A stored or submitted value in the expected shape, or null. Group IDs are positive integers, de-duplicated. */
export function parseOnlineCountFilter(value: unknown): OnlineCountFilter | null {
  if (!value || typeof value !== 'object') return null;
  const { excludedGroups, excludeMusicBots } = value as Record<string, unknown>;
  if (!Array.isArray(excludedGroups) || excludedGroups.length > ONLINE_COUNT_MAX_GROUPS) return null;
  if (typeof excludeMusicBots !== 'boolean') return null;
  if (!excludedGroups.every((id) => Number.isInteger(id) && (id as number) > 0)) return null;
  return { excludedGroups: [...new Set(excludedGroups as number[])], excludeMusicBots };
}

export async function getOnlineCountFilter(
  prisma: PrismaClient, configId: number, sid: number, scope: OnlineCountScope,
): Promise<OnlineCountFilter> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyFor(configId, sid, scope) } });
  if (!row) return ONLINE_COUNT_FILTER_DEFAULT;
  try {
    return parseOnlineCountFilter(JSON.parse(row.value)) ?? ONLINE_COUNT_FILTER_DEFAULT;
  } catch {
    return ONLINE_COUNT_FILTER_DEFAULT;
  }
}

export async function setOnlineCountFilter(
  prisma: PrismaClient, configId: number, sid: number, scope: OnlineCountScope, filter: OnlineCountFilter,
): Promise<OnlineCountFilter> {
  const key = keyFor(configId, sid, scope);
  const value = JSON.stringify(filter);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return filter;
}

/** Does this filter need group or unique-ID columns in the client list at all? */
export function filterNeedsDetails(filter: OnlineCountFilter): boolean {
  return filter.excludedGroups.length > 0 || filter.excludeMusicBots;
}

/**
 * Real users in a `clientlist` answer (voice clients only, no query logins), minus those the
 * filter leaves out. Needs the list with `-groups` for group exclusion and `-uid` for the
 * music-bot one; `ownBotUids` is what the music bot manager reports for this app's bots.
 */
export function countOnline(clients: any[], filter: OnlineCountFilter, ownBotUids: Set<string>): number {
  const excluded = filter.excludedGroups.map(String);
  return clients.filter((c) => {
    if (String(c.client_type) !== '0') return false;
    if (filter.excludeMusicBots && ownBotUids.has(String(c.client_unique_identifier ?? ''))) return false;
    const groups = String(c.client_servergroups ?? '');
    return !excluded.some((sgid) => commaListHasExact(groups, sgid));
  }).length;
}
