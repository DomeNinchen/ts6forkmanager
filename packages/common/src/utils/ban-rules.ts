import type { Ban } from '../types/teamspeak.js';
import type { ClientDbBanTarget, ClientDbProfile } from '../types/client-database.js';

// Ban rules exactly as a real TeamSpeak 6 server evaluates them, verified live (6.0.0-beta13.1):
//  - `name` and `ip` are regular expressions that must match the WHOLE value - a bare substring
//    such as `Bad` does not ban "VeryBad" - and they match case-insensitively.
//  - `uid` is compared for equality.
//  - A rule that sets several fields only matches when EVERY one of them matches.
// The Client Database page uses this both to build rules from a profile (so a ban hits exactly that
// profile) and to highlight profiles a rule already covers.

/** Makes `text` match itself literally inside a ban regex. */
export function escapeBanRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The value a ban of the given kind carries for this profile, or '' when there is nothing to ban
 * (a profile without a known IP, say). Names and IPs become exact, anchored, escaped patterns.
 */
export function banRuleValue(
  target: ClientDbBanTarget,
  profile: Pick<ClientDbProfile, 'uid' | 'nickname' | 'lastIp'>,
): string {
  switch (target) {
    case 'uid':
      return profile.uid;
    case 'name':
      return profile.nickname ? `^${escapeBanRegex(profile.nickname)}$` : '';
    case 'ip':
      return profile.lastIp ? `^${escapeBanRegex(profile.lastIp)}$` : '';
  }
}

/** Turns one raw `banlist` row (all values are strings) into a typed rule. */
export function toBan(row: Record<string, string>): Ban {
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    banid: num(row.banid),
    ip: row.ip ?? '',
    name: row.name ?? '',
    uid: row.uid ?? '',
    mytsid: row.mytsid ?? '',
    lastnickname: row.lastnickname ?? '',
    created: num(row.created),
    duration: num(row.duration),
    invokername: row.invokername ?? '',
    invokercldbid: num(row.invokercldbid),
    invokeruid: row.invokeruid ?? '',
    reason: row.reason ?? '',
    enforcements: num(row.enforcements),
  };
}

/** A rule with `duration` 0 never expires; otherwise it ends `duration` seconds after `created`. */
export function isBanActive(rule: Pick<Ban, 'created' | 'duration'>, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return rule.duration === 0 || rule.created + rule.duration > nowSec;
}

interface CompiledBanRule {
  rule: Ban;
  uid: string;
  /** undefined = the rule has no such field; null = the field is not a valid pattern, so the rule can never match. */
  ipRe: RegExp | null | undefined;
  nameRe: RegExp | null | undefined;
}

function compilePattern(pattern: string): RegExp | null | undefined {
  if (pattern === '') return undefined;
  try {
    return new RegExp(`^(?:${pattern})$`, 'i');
  } catch {
    return null;
  }
}

/** Rules prepared for matching many profiles against; build once per ban list, not once per profile. */
export interface BanIndex {
  byUid: Map<string, CompiledBanRule[]>;
  withoutUid: CompiledBanRule[];
}

export function buildBanIndex(rules: Ban[], nowSec = Math.floor(Date.now() / 1000)): BanIndex {
  const index: BanIndex = { byUid: new Map(), withoutUid: [] };
  for (const rule of rules) {
    if (!isBanActive(rule, nowSec)) continue;
    // A rule that only names a myTeamSpeak id cannot be evaluated - profiles carry no such id - so it
    // is left out rather than guessed at.
    if (rule.uid === '' && rule.ip === '' && rule.name === '') continue;
    const compiled: CompiledBanRule = {
      rule,
      uid: rule.uid,
      ipRe: compilePattern(rule.ip),
      nameRe: compilePattern(rule.name),
    };
    if (rule.uid !== '') {
      const list = index.byUid.get(rule.uid);
      if (list) list.push(compiled);
      else index.byUid.set(rule.uid, [compiled]);
    } else {
      index.withoutUid.push(compiled);
    }
  }
  return index;
}

function ruleCovers(c: CompiledBanRule, profile: Pick<ClientDbProfile, 'uid' | 'nickname' | 'lastIp'>): boolean {
  // Same "all set fields must match" rule as TeamSpeak. A rule that also names a myTeamSpeak id can
  // only be decided by the server, so it never counts as a match here.
  if (c.rule.mytsid !== '') return false;
  if (c.uid !== '' && c.uid !== profile.uid) return false;
  if (c.ipRe !== undefined && !(c.ipRe && profile.lastIp !== '' && c.ipRe.test(profile.lastIp))) return false;
  if (c.nameRe !== undefined && !(c.nameRe && c.nameRe.test(profile.nickname))) return false;
  return true;
}

/** Every active ban rule that covers the profile (empty = not banned). */
export function findBanMatches(
  index: BanIndex,
  profile: Pick<ClientDbProfile, 'uid' | 'nickname' | 'lastIp'>,
): Ban[] {
  const hits: Ban[] = [];
  for (const c of index.byUid.get(profile.uid) ?? []) if (ruleCovers(c, profile)) hits.push(c.rule);
  for (const c of index.withoutUid) if (ruleCovers(c, profile)) hits.push(c.rule);
  return hits;
}
