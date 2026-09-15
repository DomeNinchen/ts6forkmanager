/**
 * Exact-match helpers for comma-separated ID lists (server group IDs, etc.).
 * A plain substring check (e.g. this engine's expr-eval `contains()`) is wrong
 * for numeric IDs - group "1" would falsely match a client only in "10" or "21".
 */

function splitIds(csv: string): string[] {
  return String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does `csv` (e.g. a client's client_servergroups) contain `id` exactly? */
export function commaListHasExact(csv: string, id: string): boolean {
  const target = String(id).trim();
  if (!target) return false;
  return splitIds(csv).includes(target);
}

/** Does `csv` share at least one ID with `targetIdsCsv`? */
export function commaListsIntersect(csv: string, targetIdsCsv: string): boolean {
  const targets = new Set(splitIds(targetIdsCsv));
  if (targets.size === 0) return false;
  return splitIds(csv).some((id) => targets.has(id));
}
