/**
 * Who the "online users" number leaves out, set by an admin per virtual server. There are two
 * independent filters: one for the dashboard (the Online Users tile and the Lounge layout's
 * lead sentence), one for the public embed widgets. Query clients are never counted anyway.
 */
export const ONLINE_COUNT_SCOPES = ['dashboard', 'widgets'] as const;
export type OnlineCountScope = (typeof ONLINE_COUNT_SCOPES)[number];

export interface OnlineCountFilter {
  /** Server group IDs (sgid); a client in any of them is not counted. */
  excludedGroups: number[];
  /** Leave out this manager's own music bots, recognised by their unique ID. */
  excludeMusicBots: boolean;
}

export const ONLINE_COUNT_FILTER_DEFAULT: OnlineCountFilter = { excludedGroups: [], excludeMusicBots: false };

/** More than any real server has groups; guards the stored value's size. */
export const ONLINE_COUNT_MAX_GROUPS = 500;
