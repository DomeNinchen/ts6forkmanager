// Raid protection (R15): the manager watches the joins of a virtual server (from the connection
// journal) and records an incident when many clients arrive in a short time - all at once, from one
// network, from one country, with similar names, or with identities the server has never seen.
// Stage 1 only observes and tells an admin group; it never acts on a client.

export const RAID_RULE_KINDS = ['total', 'subnet', 'country', 'name', 'new'] as const;
export type RaidRuleKind = (typeof RAID_RULE_KINDS)[number];

/** "At least `count` joins within `windowSec` seconds" (per network / country / name for those rules). */
export interface RaidRule {
  enabled: boolean;
  count: number;
  windowSec: number;
}

/** New identities: at least `count` of them in the window, and at least `sharePct` % of all counted joins there. */
export interface RaidNewRule extends RaidRule {
  sharePct: number;
}

export interface RaidRules {
  total: RaidRule;
  /** Same IPv4 /24 or IPv6 /64. */
  subnet: RaidRule;
  country: RaidRule;
  /** Nicknames that are the same once digits, punctuation and case are taken away ("Raider12" = "raider_7"). */
  name: RaidRule;
  new: RaidNewRule;
}

export type RaidNotifyMode = 'off' | 'poke' | 'message';

/** Per virtual server; stored as JSON. */
export interface RaidSettings {
  rules: RaidRules;
  /** Members of these server groups never count and are never affected. */
  exemptGroupIds: number[];
  /** A client with at least this many earlier sessions in the journal counts as a known member (0 = off). */
  knownSessions: number;
  /** No incident this many minutes after the TeamSpeak server started or the manager started watching again. */
  graceMin: number;
  /** After the first switch-on: only observe for this many days (stage 3 needs an admin to switch to acting). */
  observeDays: number;
  /** Who hears about a new incident: online members of these groups, by poke or private message. */
  notify: RaidNotifyMode;
  notifyGroupIds: number[];
  /** {server}, {rules}, {clients} are filled in. A poke is cut to 100 characters. */
  notifyText: string;

  // ---- actions (stage 3); they only happen while the virtual server is switched to acting ----
  /** What each rule does to the clients it caught; a client caught by several rules gets the highest level. */
  actions: Record<RaidRuleKind, RaidAction>;
  /** `restrict`: this server group is given until restrictMinutes have passed (a temporary group, R13). */
  restrictGroupId: number | null;
  restrictMinutes: number;
  /** `ban`: a ban on the client's identity for this many minutes. */
  banMinutes: number;
  /** `ban`: also ban the address. Hits everyone behind the same address (mobile networks, offices, CGNAT). */
  banIp: boolean;
  /** At most this many actions per minute and virtual server; the rest waits for the next minute. */
  maxActionsPerMin: number;
  /** `warn`: the private message; `kick`: the reason (cut to 40 characters); `ban`: the ban reason. {server} is filled in. */
  warnText: string;
  kickReason: string;
  banReason: string;
}

/** The ladder, lowest first. */
export const RAID_ACTIONS = ['none', 'warn', 'restrict', 'kick', 'ban'] as const;
export type RaidAction = (typeof RAID_ACTIONS)[number];

/** The level of the highest action among the rules that caught a client. */
export function raidActionFor(rules: RaidRuleKind[], actions: Record<RaidRuleKind, RaidAction>): RaidAction {
  return rules.reduce<RaidAction>((best, r) => (RAID_ACTIONS.indexOf(actions[r]) > RAID_ACTIONS.indexOf(best) ? actions[r] : best), 'none');
}

export const RAID_PRESETS = ['lax', 'medium', 'strict'] as const;
export type RaidPreset = (typeof RAID_PRESETS)[number];

// Provisional numbers, to be replaced by values measured on real servers (README/wiki say so).
const rules = (total: number, subnet: number, name: number, newCount: number, sharePct: number): RaidRules => ({
  total: { enabled: true, count: total, windowSec: 60 },
  subnet: { enabled: true, count: subnet, windowSec: 60 },
  country: { enabled: false, count: total, windowSec: 60 },
  name: { enabled: true, count: name, windowSec: 60 },
  new: { enabled: true, count: newCount, windowSec: 60, sharePct },
});

export const RAID_PRESET_RULES: Record<RaidPreset, RaidRules> = {
  lax: rules(25, 8, 6, 12, 80),
  medium: rules(15, 5, 5, 8, 70),
  strict: rules(10, 3, 3, 5, 60),
};

export const RAID_DEFAULTS: RaidSettings = {
  rules: RAID_PRESET_RULES.medium,
  exemptGroupIds: [],
  knownSessions: 3,
  graceMin: 5,
  observeDays: 7,
  notify: 'off',
  notifyGroupIds: [],
  notifyText: 'Raid protection on {server}: {rules} ({clients} clients)',
  actions: { total: 'none', subnet: 'none', country: 'none', name: 'none', new: 'none' },
  restrictGroupId: null,
  restrictMinutes: 60,
  banMinutes: 30,
  banIp: false,
  maxActionsPerMin: 20,
  warnText: 'Many clients are joining {server} right now. If you are here by mistake, please leave.',
  kickReason: 'Raid protection',
  banReason: 'Raid protection: many joins at once',
};

export const RAID_LIMITS = {
  count: [2, 1000],
  windowSec: [5, 3600],
  sharePct: [1, 100],
  knownSessions: [0, 1000],
  graceMin: [0, 120],
  observeDays: [0, 365],
  notifyTextMax: 1000,
  groupsMax: 100,
  restrictMinutes: [1, 10080],
  // His decision 8: a short ban only.
  banMinutes: [10, 60],
  maxActionsPerMin: [1, 100],
  warnTextMax: 1000,
  kickReasonMax: 40,
  banReasonMax: 80,
} as const;

export const RAID_RETENTION_DEFAULT_DAYS = 90;
export const RAID_RETENTION_MIN_DAYS = 1;
export const RAID_RETENTION_MAX_DAYS = 3650;

const intIn = (v: unknown, [min, max]: readonly [number, number]) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const ids = (v: unknown) => Array.isArray(v) && v.length <= RAID_LIMITS.groupsMax && v.every((x) => intIn(x, [1, 2 ** 31 - 1]));

/** What is wrong with the settings, as a short English sentence; null when they can be saved. */
export function raidSettingsProblem(s: RaidSettings): string | null {
  if (!s || typeof s !== 'object' || !s.rules || typeof s.rules !== 'object') return 'settings missing';
  for (const kind of RAID_RULE_KINDS) {
    const r = s.rules[kind] as RaidNewRule | undefined;
    if (!r || typeof r.enabled !== 'boolean') return `rule ${kind}: missing`;
    if (!intIn(r.count, RAID_LIMITS.count)) return `rule ${kind}: count must be ${RAID_LIMITS.count[0]}-${RAID_LIMITS.count[1]}`;
    if (!intIn(r.windowSec, RAID_LIMITS.windowSec)) return `rule ${kind}: window must be ${RAID_LIMITS.windowSec[0]}-${RAID_LIMITS.windowSec[1]} seconds`;
    if (kind === 'new' && !intIn(r.sharePct, RAID_LIMITS.sharePct)) return 'rule new: share must be 1-100 %';
  }
  if (!ids(s.exemptGroupIds)) return 'exemptGroupIds: list of group ids';
  if (!ids(s.notifyGroupIds)) return 'notifyGroupIds: list of group ids';
  if (!intIn(s.knownSessions, RAID_LIMITS.knownSessions)) return `knownSessions must be ${RAID_LIMITS.knownSessions[0]}-${RAID_LIMITS.knownSessions[1]}`;
  if (!intIn(s.graceMin, RAID_LIMITS.graceMin)) return `graceMin must be ${RAID_LIMITS.graceMin[0]}-${RAID_LIMITS.graceMin[1]}`;
  if (!intIn(s.observeDays, RAID_LIMITS.observeDays)) return `observeDays must be ${RAID_LIMITS.observeDays[0]}-${RAID_LIMITS.observeDays[1]}`;
  if (!['off', 'poke', 'message'].includes(s.notify)) return 'notify must be off, poke or message';
  if (typeof s.notifyText !== 'string' || s.notifyText.length > RAID_LIMITS.notifyTextMax) return `notifyText: at most ${RAID_LIMITS.notifyTextMax} characters`;
  if (s.notify !== 'off' && !s.notifyText.trim()) return 'notifyText is empty';
  if (!s.actions || typeof s.actions !== 'object' || !RAID_RULE_KINDS.every((k) => RAID_ACTIONS.includes(s.actions[k]))) return 'actions: one of none, warn, restrict, kick, ban per rule';
  const used = RAID_RULE_KINDS.filter((k) => s.rules[k].enabled).map((k) => s.actions[k]);
  if (s.restrictGroupId !== null && !intIn(s.restrictGroupId, [1, 2 ** 31 - 1])) return 'restrictGroupId: a group id or null';
  if (used.includes('restrict') && s.restrictGroupId === null) return 'restrict needs a server group';
  if (!intIn(s.restrictMinutes, RAID_LIMITS.restrictMinutes)) return `restrictMinutes must be ${RAID_LIMITS.restrictMinutes[0]}-${RAID_LIMITS.restrictMinutes[1]}`;
  if (!intIn(s.banMinutes, RAID_LIMITS.banMinutes)) return `banMinutes must be ${RAID_LIMITS.banMinutes[0]}-${RAID_LIMITS.banMinutes[1]}`;
  if (typeof s.banIp !== 'boolean') return 'banIp must be true or false';
  if (!intIn(s.maxActionsPerMin, RAID_LIMITS.maxActionsPerMin)) return `maxActionsPerMin must be ${RAID_LIMITS.maxActionsPerMin[0]}-${RAID_LIMITS.maxActionsPerMin[1]}`;
  if (typeof s.warnText !== 'string' || s.warnText.length > RAID_LIMITS.warnTextMax || (used.includes('warn') && !s.warnText.trim())) return 'warnText: 1-1000 characters';
  if (typeof s.kickReason !== 'string' || s.kickReason.length > RAID_LIMITS.kickReasonMax) return `kickReason: at most ${RAID_LIMITS.kickReasonMax} characters`;
  if (typeof s.banReason !== 'string' || s.banReason.length > RAID_LIMITS.banReasonMax) return `banReason: at most ${RAID_LIMITS.banReasonMax} characters`;
  return null;
}

/** The preset the rules match exactly, or null for own numbers. */
export function raidPresetOf(r: RaidRules): RaidPreset | null {
  return RAID_PRESETS.find((p) => JSON.stringify(RAID_PRESET_RULES[p]) === JSON.stringify(r)) ?? null;
}

// --- Incidents ------------------------------------------------------------------------------

/** One rule that fired: `key` is the network, country or name stem it fired for (null for total/new). */
export interface RaidHit {
  rule: RaidRuleKind;
  key: string | null;
  /** The most joins seen in one window for this rule and key. */
  count: number;
  windowSec: number;
  /** ISO 8601, first time it fired in this incident. */
  at: string;
}

/** A client that joined during the spike and counted for at least one rule. */
export interface RaidClient {
  clid: number;
  uid: string;
  cldbid: number | null;
  nickname: string;
  ip: string | null;
  country: string | null;
  /** ISO 8601. */
  joinedAt: string;
  /** No earlier session of this identity in the journal of this virtual server. */
  isNew: boolean;
  /** When TeamSpeak created the identity's database entry (ISO 8601), if known. */
  createdAt: string | null;
  /** The level the rules that caught this client ask for ('none' = only recorded). In observe mode: what would happen. */
  action?: RaidAction;
  /** What became of it while acting; absent in observe mode. */
  outcome?: RaidOutcome;
}

/**
 * - `pending`: waits for its turn (the per-minute limit).
 * - `running`: started; if the manager stopped right then, it is never tried again (no double action).
 * - `done`, `failed` (with the reason), `gone` (left before it was its turn; a warning or kick needs the client online),
 * - `skipped` (exempt by now, already a member, ...), `stopped` (emergency stop or switched back to observing).
 */
export type RaidOutcomeState = 'pending' | 'running' | 'done' | 'failed' | 'gone' | 'skipped' | 'stopped';

export interface RaidOutcome {
  state: RaidOutcomeState;
  /** ISO 8601 of the last change. */
  at: string;
  note: string | null;
}

export type RaidIncidentState = 'open' | 'closed';

export interface RaidNotice {
  at: string;
  mode: Exclude<RaidNotifyMode, 'off'>;
  sent: number;
  failed: number;
  /** Why nothing went out (no member of the groups online, no connection, ...). */
  note: string | null;
}

/** The fixed notes a RaidNotice can carry (the page translates them); any other note is a TeamSpeak error text. */
export const RAID_NOTICE_NOTES = {
  nobodyOnline: 'nobody of the notify groups is online',
  noClientList: 'cannot read the client list',
} as const;

export interface RaidIncidentEntry {
  id: number;
  serverConfigId: number;
  sid: number;
  state: RaidIncidentState;
  /** 'observe': nothing was done to the clients. */
  /** 'observe': nothing was done (the clients show what would have happened); 'act': the actions were carried out. */
  mode: 'observe' | 'act';
  startedAt: string;
  lastHitAt: string;
  endedAt: string | null;
  hits: RaidHit[];
  clients: RaidClient[];
  clientCount: number;
  notice: RaidNotice | null;
}

/** At most this many clients are kept on one incident (the count goes on). */
export const RAID_INCIDENT_CLIENTS_MAX = 500;

// --- Status ---------------------------------------------------------------------------------

/**
 * - `live`: joins arrive as events (SSH).
 * - `delayed`: the journal polls the client list every 15 s; a client who comes and goes in between is missed.
 * - `journal-off`: the connection does not record its journal - raid protection sees nothing.
 * - `unreachable`: the journal cannot read this virtual server right now.
 */
export type RaidDetection = 'live' | 'delayed' | 'journal-off' | 'unreachable';

export interface RaidProtectionStatus {
  detection: RaidDetection;
  /** No new incident until then (server start / watching again); null when not paused. */
  pausedUntil: string | null;
  pauseReason: 'server-start' | 'watching-again' | null;
  openIncidentId: number | null;
  /** RAID_ACTIONS_DISABLED is set on the backend: nothing is ever done to a client, whatever the switch says. */
  actionsDisabled: boolean;
  /** The last action TeamSpeak refused, e.g. for missing power (2568), until an action works again. */
  actionError: { at: string; action: RaidAction; note: string } | null;
}

export interface RaidProtectionConfig {
  enabled: boolean;
  /** The first time it was switched on (ISO 8601); null if never. */
  firstEnabledAt: string | null;
  observeUntil: string | null;
  /** Switched to acting by an admin: the actions of the rules are carried out. */
  acting: boolean;
  actingSince: string | null;
  /** The last emergency stop: when and by whom. */
  stoppedAt: string | null;
  stoppedBy: string | null;
  settings: RaidSettings;
}

/** Codes of refused switches (the page words them). */
export const RAID_ERROR_CODES = {
  observeTimeRunning: 'RAID_OBSERVE_TIME_RUNNING',
  notEnabled: 'RAID_NOT_ENABLED',
  actionsDisabled: 'RAID_ACTIONS_DISABLED',
} as const;

export interface RaidProtectionView {
  config: RaidProtectionConfig;
  status: RaidProtectionStatus;
}
