import net from 'node:net';
import {
  RAID_ACTIONS,
  RAID_INCIDENT_CLIENTS_MAX,
  RAID_RULE_KINDS,
  raidActionFor,
  type RaidAction,
  type RaidClient,
  type RaidHit,
  type RaidRuleKind,
  type RaidRules,
} from '@ts6/common';

// Raid protection (R15), the pure part: sliding windows over the joins of one virtual server.
// Everything here is decided from its arguments, so it is tested without a server.

/** One join as the detector sees it (from a connection journal row). */
export interface RaidJoin {
  rowId: number;
  /** ms */
  at: number;
  clid: number;
  uid: string;
  cldbid: number | null;
  nickname: string;
  ip: string | null;
  country: string | null;
  /** No earlier session of this identity on this virtual server. */
  isNew: boolean;
  /** Never counts: query client, own bot, exempt or protected group, supporter, known member. */
  exempt: boolean;
  /** ms, when TeamSpeak created the identity's database entry. */
  createdAt: number | null;
}

/** A rule that fired for the latest join, with the joins that make it fire. */
export interface RaidHitNow {
  rule: RaidRuleKind;
  key: string | null;
  count: number;
  windowSec: number;
  joins: RaidJoin[];
}

/** The eight 16-bit groups of an IPv6 address, or null. */
function v6Groups(ip: string): number[] | null {
  if (!net.isIPv6(ip)) return null;
  let text = ip.split('%')[0];
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const v4 = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = text.slice(0, -v4[0].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const parse = (s: string | undefined) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
  const h = parse(head);
  const t = parse(tail);
  const groups = tail === undefined ? h : [...h, ...new Array(8 - h.length - t.length).fill(0), ...t];
  return groups.length === 8 ? groups : null;
}

/** The network a join came from: IPv4 /24, IPv6 /64 (an IPv4-mapped IPv6 address counts as IPv4). */
export function subnetKey(ip: string | null): string | null {
  if (!ip) return null;
  if (net.isIPv4(ip)) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  const g = v6Groups(ip);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.0/24`;
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/** A nickname without case, accents, digits and punctuation; null when fewer than 3 letters are left. */
export function nameKey(nickname: string): string | null {
  const key = nickname.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}]/gu, '');
  return key.length >= 3 ? key : null;
}

function keyOf(kind: RaidRuleKind, j: RaidJoin): string | null {
  if (kind === 'subnet') return subnetKey(j.ip);
  if (kind === 'country') return j.country || null;
  if (kind === 'name') return nameKey(j.nickname);
  return null;
}

/**
 * The rules that fire for `latest`: each looks back its own window from the latest join's time (ends
 * included, so "N within S seconds" means at most S seconds between the first and the N-th). Exempt joins
 * never count, and nothing that joined before `countFrom` (the end of a pause) counts either.
 * Only the latest join's network, country and name are checked: an earlier join's group cannot have grown.
 * shortcut: joins that arrive out of order (one 15 s poll at a time) are judged in arrival order; a group can fire one join later than it would live.
 */
export function detect(joins: RaidJoin[], latest: RaidJoin, rules: RaidRules, countFrom = 0): RaidHitNow[] {
  if (latest.exempt || latest.at < countFrom) return [];
  const hits: RaidHitNow[] = [];
  for (const kind of RAID_RULE_KINDS) {
    const r = rules[kind];
    if (!r.enabled) continue;
    const from = Math.max(latest.at - r.windowSec * 1000, countFrom);
    const inWindow = joins.filter((j) => !j.exempt && j.at >= from && j.at <= latest.at);
    let key: string | null = null;
    let group = inWindow;
    if (kind === 'new') {
      group = inWindow.filter((j) => j.isNew);
      if (group.length * 100 < rules.new.sharePct * inWindow.length) continue;
    } else if (kind !== 'total') {
      key = keyOf(kind, latest);
      if (!key) continue;
      group = inWindow.filter((j) => keyOf(kind, j) === key);
    }
    if (group.length >= r.count) hits.push({ rule: kind, key, count: group.length, windowSec: r.windowSec, joins: group });
  }
  return hits;
}

export function parseGroupList(list: string | null): number[] {
  return (list ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Whether a join never counts and is never affected (his decision 9): query clients, this app's own
 * music bots, members of an exempt group (configured, protected, supporter), known members.
 */
export function isExempt(
  j: { type: number; uid: string; groups: number[]; earlierSessions: number },
  ctx: { ownBotUids: Set<string>; exemptGroups: Set<number>; knownSessions: number },
): boolean {
  if (j.type !== 0) return true;
  if (ctx.ownBotUids.has(j.uid)) return true;
  if (j.groups.some((g) => ctx.exemptGroups.has(g))) return true;
  return ctx.knownSessions > 0 && j.earlierSessions >= ctx.knownSessions;
}

/** The longest window of the enabled rules, in ms: how long joins are kept, and how long an incident stays open without a new hit. */
export function longestWindowMs(rules: RaidRules): number {
  const windows = RAID_RULE_KINDS.filter((k) => rules[k].enabled).map((k) => rules[k].windowSec);
  return Math.max(60, ...windows) * 1000;
}

/**
 * The end of the latest pause (his decision 10): `graceMin` after the TeamSpeak server started (everyone
 * reconnects at once after a restart) and after the manager started watching this virtual server again
 * (its own start, an outage). Joins before it never count. Null when neither time is known.
 */
export function pauseEnd(
  graceMin: number,
  serverStartedAt: number | null,
  watchingSince: number | null,
): { until: number; reason: 'server-start' | 'watching-again' } | null {
  const grace = graceMin * 60_000;
  const candidates = [
    serverStartedAt === null ? null : { until: serverStartedAt + grace, reason: 'server-start' as const },
    watchingSince === null ? null : { until: watchingSince + grace, reason: 'watching-again' as const },
  ].filter((c): c is { until: number; reason: 'server-start' | 'watching-again' } => c !== null);
  return candidates.sort((a, b) => b.until - a.until)[0] ?? null;
}

export function toRaidClient(j: RaidJoin): RaidClient {
  return {
    clid: j.clid,
    uid: j.uid,
    cldbid: j.cldbid,
    nickname: j.nickname,
    ip: j.ip,
    country: j.country,
    joinedAt: new Date(j.at).toISOString(),
    isNew: j.isNew,
    createdAt: j.createdAt === null ? null : new Date(j.createdAt).toISOString(),
  };
}

/**
 * An incident's hits and clients with the latest hits added: one hit per rule and key (the highest
 * count seen), one client per identity and join time, at most RAID_INCIDENT_CLIENTS_MAX kept.
 */
export function mergeIncident(
  current: { hits: RaidHit[]; clients: RaidClient[]; clientCount: number },
  now: RaidHitNow[],
  at: number,
  /** Stage 3: the level each client gets (highest of the rules that caught it); `acting` queues it as pending. */
  ladder?: { actions: Record<RaidRuleKind, RaidAction>; acting: boolean },
): { hits: RaidHit[]; clients: RaidClient[]; clientCount: number } {
  const hits = current.hits.map((h) => ({ ...h }));
  for (const h of now) {
    const known = hits.find((x) => x.rule === h.rule && x.key === h.key);
    if (known) known.count = Math.max(known.count, h.count);
    else hits.push({ rule: h.rule, key: h.key, count: h.count, windowSec: h.windowSec, at: new Date(at).toISOString() });
  }
  const clients = current.clients.map((c) => ({ ...c }));
  const byId = new Map(clients.map((c) => [`${c.uid}|${c.joinedAt}`, c]));
  let clientCount = current.clientCount;
  for (const j of now.flatMap((h) => h.joins)) {
    const c = toRaidClient(j);
    const id = `${c.uid}|${c.joinedAt}`;
    const action = ladder ? raidActionFor(now.filter((h) => h.joins.includes(j)).map((h) => h.rule), ladder.actions) : undefined;
    const known = byId.get(id);
    if (known) {
      // A higher rule caught it later: the level goes up as long as nothing was done yet.
      if (action && RAID_ACTIONS.indexOf(action) > RAID_ACTIONS.indexOf(known.action ?? 'none') && (!known.outcome || known.outcome.state === 'pending')) {
        known.action = action;
        if (ladder?.acting) known.outcome = { state: 'pending', at: new Date(at).toISOString(), note: null };
      }
      continue;
    }
    clientCount++;
    if (action) {
      c.action = action;
      if (ladder?.acting && action !== 'none') c.outcome = { state: 'pending', at: new Date(at).toISOString(), note: null };
    }
    // shortcut: beyond the cap a client is counted but not kept, so a repeat of it is counted again; raise the cap if incidents that big are real.
    if (clients.length < RAID_INCIDENT_CLIENTS_MAX) {
      clients.push(c);
      byId.set(id, c);
    }
  }
  return { hits, clients, clientCount };
}

/** How many actions may start now: at most `perMin` within any minute (the times are kept by the caller). */
export function actionBudget(recent: number[], now: number, perMin: number): number {
  return Math.max(0, perMin - recent.filter((t) => now - t < 60_000).length);
}

/** "12 joins in 60 s, 12 from 172.17.0.0/24" - the English summary for the notice's {rules}. */
export function describeHits(hits: RaidHit[]): string {
  const what: Record<RaidRuleKind, (h: RaidHit) => string> = {
    total: (h) => `${h.count} joins in ${h.windowSec} s`,
    subnet: (h) => `${h.count} from ${h.key}`,
    country: (h) => `${h.count} from ${h.key}`,
    name: (h) => `${h.count} named like "${h.key}"`,
    new: (h) => `${h.count} new identities`,
  };
  return hits.map((h) => what[h.rule](h)).join(', ');
}
