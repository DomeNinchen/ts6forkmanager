// Shapes exchanged between the backend's client-database routes and the Client Database page.
// The backend normalises TeamSpeak's all-strings ServerQuery rows into these (numbers are numbers,
// missing fields are empty strings), so the page never has to guess at raw field names.

/** One profile in a virtual server's client database (from clientdblist / clientdbinfo). */
export interface ClientDbProfile {
  cldbid: number;
  /** Unique identifier. Empty for nothing the server could report one for. */
  uid: string;
  nickname: string;
  /** Unix seconds. */
  created: number;
  /** Unix seconds. */
  lastConnected: number;
  totalConnections: number;
  /** Last known IP address; empty when the server has none (or the API user may not see it). */
  lastIp: string;
  description: string;
  /** ServerQuery login name; only clientdblist reports it, so it is empty for profiles read via clientdbinfo. */
  loginName: string;
}

/** One block of the database listing. */
export interface ClientDbListPage {
  /** Number of profiles in the whole database when the block was read (clientdblist -count). */
  total: number;
  /** The block's profiles, newest (highest database id) first. */
  entries: ClientDbProfile[];
}

export type ClientDbSearchMode = 'name' | 'uid' | 'dbid' | 'custom' | 'channelgroup';

export interface ClientDbSearchParams {
  mode: ClientDbSearchMode;
  /**
   * name / uid: the pattern (SQL wildcard `%`; without any `%` the text is matched as "contains").
   * dbid: the database id. custom: the value pattern (SQL wildcard `%`, defaults to everything).
   */
  query?: string;
  /** custom: the property identifier. TeamSpeak needs it exactly - it cannot be searched with a wildcard. */
  ident?: string;
  /** channelgroup: only assignments in this channel; omitted = every channel. */
  cid?: number;
  /** channelgroup: only this channel group; omitted = every group except the server's default channel group. */
  cgid?: number;
}

/** A custom property (custominfo) of a profile. */
export interface ClientDbCustomEntry {
  ident: string;
  value: string;
}

/** A channel group a profile holds in one channel. */
export interface ClientDbChannelGroupEntry {
  cid: number;
  cgid: number;
}

export interface ClientDbSearchResult {
  entries: ClientDbProfile[];
  /** More profiles matched than are listed (TeamSpeak caps clientdbfind at 50; the other modes are capped by this app). */
  truncated: boolean;
  /** How many profiles matched before any capping, as far as it is known. */
  matchCount: number;
  /** custom mode: the matching property of each listed profile, by database id. */
  custom?: Record<number, ClientDbCustomEntry[]>;
  /** channelgroup mode: the matching assignments of each listed profile, by database id. */
  channelGroups?: Record<number, ClientDbChannelGroupEntry[]>;
}

/** Sections of the detail view the server refused to give (usually missing permissions), so the page can say "unavailable" instead of "none". */
export type ClientDbDetailSection = 'custom' | 'serverGroups' | 'channelGroups' | 'online';

export interface ClientDbDetails {
  profile: ClientDbProfile;
  /** md5 of the profile's avatar file (client_flag_avatar); empty = no avatar. */
  avatarHash: string;
  /** Bytes. */
  traffic: { monthUp: number; monthDown: number; totalUp: number; totalDown: number };
  custom: ClientDbCustomEntry[];
  serverGroups: { sgid: number; name: string }[];
  channelGroups: ClientDbChannelGroupEntry[];
  /** Set while the profile is connected right now. */
  online: { clid: number; cid: number } | null;
  unavailable: ClientDbDetailSection[];
}

/** What a ban rule created from a profile is matched on. */
export type ClientDbBanTarget = 'uid' | 'name' | 'ip';

export interface ClientDbBanRequest {
  cldbids: number[];
  /** One ban rule is created per profile and target. */
  targets: ClientDbBanTarget[];
  /** Seconds; 0 = permanent. */
  time: number;
  reason?: string;
}

export interface ClientDbBanOutcome {
  cldbid: number;
  nickname: string;
  target: ClientDbBanTarget;
  status: 'created' | 'skipped' | 'failed';
  /** created: the new ban rule's id. */
  banid?: number;
  /** skipped: why there was nothing to ban (e.g. the profile has no IP); failed: TeamSpeak's error text. */
  message?: string;
}

export interface ClientDbBanResult {
  outcomes: ClientDbBanOutcome[];
}

export interface ClientDbDeleteResult {
  deleted: number[];
  /** TeamSpeak refuses to delete the profile of a client that is connected right now (error 523). */
  online: number[];
  failed: { cldbid: number; message: string; code?: number }[];
}
