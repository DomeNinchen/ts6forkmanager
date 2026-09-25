// TeamSpeak icon IDs are the CRC32 checksum of the icon file's bytes, so they
// use the full unsigned 32-bit range. ServerQuery, however, reports them from a
// signed 32-bit field: an icon whose CRC32 is above 2^31-1 comes back negative
// (verified on a real TS6 server - an icon uploaded as `icon_2752363917` is
// reported by `servergrouplist` as `iconid=-1542603379`). Everything that
// compares an assigned icon ID against the server's icon pool has to normalize
// first, or those icons silently look "unused".

const UINT32 = 0x100000000;

/** Normalize a ServerQuery-reported icon ID to its unsigned CRC32 value.
 * Returns 0 for "no icon" and for anything unparsable. */
export function normalizeIconId(raw: number | string | null | undefined): number {
  const value = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value) || value === 0) return 0;
  return value < 0 ? value + UINT32 : value;
}

/** Icon IDs below this belong to the TeamSpeak client's own built-in icon set
 * (100, 200, 300, 500, 600, ... are the stock group icons) rather than to a
 * file in the server's icon pool, so they can never be resolved to an upload. */
export const BUILTIN_ICON_ID_MAX = 1000;

export function isBuiltinIconId(iconId: number): boolean {
  return iconId > 0 && iconId < BUILTIN_ICON_ID_MAX;
}
