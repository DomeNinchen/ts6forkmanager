// Which value of a permission applies to a client, from the rows `permoverview` returns. Rules from
// doc/server/permissiondoc.txt shipped with the server (the authority; some online docs state a
// different, wrong order):
//  - tiers, each overwriting the one before: server groups (1) < client (2) < channel (3)
//    < channel group (4) < channel + client (5);
//  - within one tier the highest value wins, except that negated entries take over and the LOWEST
//    of those wins (how a restrictive "Sticky" group claws a permission back);
//  - a skip flag on a tier 1 or 2 entry shields it from tiers 3 and 4. Tier 5 still overrides it -
//    the docs only name 3 and 4.

/** `permoverview` reports the tier as `t` 0-4; this is its rank 1-5 in the order above. */
export const OVERVIEW_TIER_RANK: Record<number, 1 | 2 | 3 | 4 | 5> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 };

export interface OverviewSource {
  rank: number;
  permsid: string;
  permvalue: number;
  permnegated: number | boolean;
  permskip: number | boolean;
}

export interface ResolvedPermission<T extends OverviewSource> {
  permsid: string;
  /** Every row for this permission, in input order, so the result can be checked by eye. */
  sources: T[];
  winner: T;
  /** A skip flag on tier 1 or 2 kept tiers 3 and 4 out. */
  shielded: boolean;
}

function pickWithinTier<T extends OverviewSource>(list: T[]): T {
  const negated = list.filter((r) => r.permnegated);
  const pool = negated.length ? negated : list;
  return pool.reduce((best, r) =>
    negated.length ? (r.permvalue < best.permvalue ? r : best) : (r.permvalue > best.permvalue ? r : best));
}

/** Resolves every permission in the rows; sorted by permission name. */
export function resolvePermissionOverview<T extends OverviewSource>(rows: T[]): ResolvedPermission<T>[] {
  const byPerm = new Map<string, T[]>();
  for (const r of rows) {
    if (!byPerm.has(r.permsid)) byPerm.set(r.permsid, []);
    byPerm.get(r.permsid)!.push(r);
  }
  return [...byPerm.entries()].map(([permsid, sources]) => {
    const perTier = new Map<number, T>();
    for (const rank of new Set(sources.map((r) => r.rank))) {
      perTier.set(rank, pickWithinTier(sources.filter((r) => r.rank === rank)));
    }
    const shielded = [1, 2].some((t) => !!perTier.get(t)?.permskip);
    const ranks = [...perTier.keys()].filter((t) => !(shielded && (t === 3 || t === 4)));
    const winner = perTier.get(Math.max(...ranks))!;
    return { permsid, sources, winner, shielded };
  }).sort((a, b) => a.permsid.localeCompare(b.permsid));
}
