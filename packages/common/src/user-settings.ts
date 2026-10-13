// Settings that follow a user's account instead of one browser. Each has a key, a shape
// and a parser: the backend runs the parser on everything it is asked to store and the
// frontend on everything it reads back, so a value that is broken (edited by hand, or
// written by another version) counts as "not set" rather than breaking the page.

/** How wide a dashboard tile is on a wide screen: 1 = a third of the row, 2 = two thirds, 3 = the whole row. */
export type DashboardTileWidth = 1 | 2 | 3;

export interface DashboardTileSetting {
  /** The tile's stable id, as the frontend's tile registry names it. */
  id: string;
  width: DashboardTileWidth;
  /** Kept in the list but not shown, so switching it back on keeps its place and width. */
  hidden?: boolean;
}

/** One user's dashboard: the tiles in the order they appear. A tile the list does not mention is the frontend's to place. */
export interface DashboardLayoutSetting {
  tiles: DashboardTileSetting[];
}

export interface UserSettings {
  dashboardLayout?: DashboardLayoutSetting;
}

export const USER_SETTING_KEYS = ['dashboardLayout'] as const satisfies readonly (keyof UserSettings)[];
export type UserSettingKey = (typeof USER_SETTING_KEYS)[number];

export function isUserSettingKey(key: string): key is UserSettingKey {
  return (USER_SETTING_KEYS as readonly string[]).includes(key);
}

/** Far more than the dashboard has tiles; it only bounds what a client can make the server store. */
export const DASHBOARD_LAYOUT_MAX_TILES = 32;
const TILE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

/** The cleaned layout, or null when the value is not a usable one (wrong shape, unknown width, duplicate id, too many tiles). */
function parseDashboardLayout(raw: unknown): DashboardLayoutSetting | null {
  const input = (raw as { tiles?: unknown } | null)?.tiles;
  if (!Array.isArray(input) || input.length > DASHBOARD_LAYOUT_MAX_TILES) return null;

  const seen = new Set<string>();
  const tiles: DashboardTileSetting[] = [];
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { id, width, hidden } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !TILE_ID_PATTERN.test(id) || seen.has(id)) return null;
    if (width !== 1 && width !== 2 && width !== 3) return null;
    if (hidden !== undefined && typeof hidden !== 'boolean') return null;
    seen.add(id);
    tiles.push(hidden ? { id, width, hidden } : { id, width });
  }
  return { tiles };
}

const PARSERS: { [K in UserSettingKey]: (raw: unknown) => UserSettings[K] | null } = {
  dashboardLayout: parseDashboardLayout,
};

/** The cleaned value for `key` (unknown fields dropped), or null when `raw` is not a valid one. */
export function parseUserSetting<K extends UserSettingKey>(key: K, raw: unknown): UserSettings[K] | null {
  return PARSERS[key](raw);
}
