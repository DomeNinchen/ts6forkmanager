// hostinfo values arrive as strings ("0", "32"): a missing field is null, a real 0 stays 0.
export function countOf(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// "left / right", just "left" when right is unknown, "-" when left is unknown.
export function countPair(left: unknown, right: unknown): string {
  const l = countOf(left);
  if (l === null) return '-';
  const r = countOf(right);
  return r === null ? String(l) : `${l} / ${r}`;
}
