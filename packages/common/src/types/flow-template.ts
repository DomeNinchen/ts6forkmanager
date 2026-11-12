// Shareable flow template file ("ts6-flow-template"). A template is a bot flow in
// the editor format plus a list of inputs: places in node settings that hold
// something server-specific (a channel, a group, a music bot) and are filled in
// again on the server that imports it. Secrets are emptied on export and listed
// so the importer knows what to enter again.

export const FLOW_TEMPLATE_FORMAT = 'ts6-flow-template';
/** Bump when the file layout changes in a way an older manager cannot read. */
export const FLOW_TEMPLATE_FORMAT_VERSION = 1;
export const FLOW_TEMPLATE_MAX_BYTES = 1024 * 1024;
export const FLOW_TEMPLATE_MAX_NODES = 500;
export const FLOW_TEMPLATE_MAX_INPUTS = 200;

export type FlowTemplateInputType = 'channel' | 'servergroup' | 'channelgroup' | 'bot' | 'text' | 'number' | 'select';
export const FLOW_TEMPLATE_INPUT_TYPES: readonly FlowTemplateInputType[] = ['channel', 'servergroup', 'channelgroup', 'bot', 'text', 'number', 'select'];

export type FlowTemplateLanguage = 'de' | 'en' | 'fr';

/** A spot in one node's settings; `field` is a dot path into `config` (e.g. `params.cid`, `headers.Authorization`). */
export interface FlowTemplateTarget { node: string; field: string }

export interface FlowTemplateInput {
  key: string;
  type: FlowTemplateInputType;
  label: string;
  required?: boolean;
  /**
   * Value used when the importer gives none (on export: the value the flow had).
   * Server objects (channel, servergroup, channelgroup, bot) never fall back to it:
   * there it is the id on the exporting server, only a hint.
   */
  default?: string;
  /** Server objects: their names on the exporting server, in the order of `default`; the import suggests objects with the same name. */
  names?: string[];
  /** For `select`. */
  options?: { label: string; value: string }[];
  /** The value is a comma-separated list (several channels/groups). */
  multiple?: boolean;
  targets: FlowTemplateTarget[];
}

export interface FlowTemplateNode {
  id: string;
  type: string;
  label?: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
}

export interface FlowTemplateEdge {
  id: string;
  source: string;
  sourcePort?: string;
  target: string;
  targetPort?: string;
  waypoints?: { x: number; y: number }[];
}

export interface FlowTemplateFile {
  format: typeof FLOW_TEMPLATE_FORMAT;
  formatVersion: number;
  /** Stable id of the template across versions, lowercase letters, digits and dashes. */
  id: string;
  name: string;
  /** major.minor.patch - a new major means the inputs changed and must be mapped again. */
  version: string;
  description?: string;
  /** Free text only, never checked. */
  author?: string;
  source?: string;
  /** Optional translations of name and description; English (the top-level fields) is the fallback. */
  translations?: Partial<Record<FlowTemplateLanguage, { name?: string; description?: string }>>;
  inputs: FlowTemplateInput[];
  /** Emptied on export, to be entered again after import. */
  secrets: FlowTemplateTarget[];
  flow: { nodes: FlowTemplateNode[]; edges: FlowTemplateEdge[] };
}

/** Where an imported flow came from, kept in its flowData. */
export interface ImportedTemplateRef {
  id: string;
  version: string;
  name: string;
  /** Set once an admin enabled the imported flow for the first time. */
  approved?: boolean;
}

/** Something the export could not turn into an input: the value may still point at an object of the old server. */
export interface FlowTemplateWarning extends FlowTemplateTarget {
  reason: 'expression' | 'event-filter' | 'webquery' | 'rank-list' | 'support-queue';
}

/** Input types that name an object of the server. */
export const FLOW_TEMPLATE_OBJECT_TYPES: readonly FlowTemplateInputType[] = ['channel', 'servergroup', 'channelgroup', 'bot'];

/** Something an imported flow can do, listed before the import. */
export type FlowCapabilityKind =
  | 'kick' | 'ban' | 'move' | 'poke' | 'message' | 'groups' | 'channels'
  | 'serverquery' | 'http' | 'webhookTrigger' | 'voice' | 'supportQueue';

export interface FlowCapability {
  kind: FlowCapabilityKind;
  /** Ids of the nodes that do it. */
  nodes: string[];
  /** 'http': the hosts; 'serverquery': the commands that change something. */
  details?: string[];
}

/** One node in a flow comparison. */
export interface FlowDiffNode { id: string; type: string; label?: string }

/** A setting that differs; values are shortened, secrets masked. */
export interface FlowDiffField { field: string; before?: string; after?: string }

/** What changes from one flow to another (positions are ignored). */
export interface FlowDiff {
  added: FlowDiffNode[];
  removed: FlowDiffNode[];
  changed: (FlowDiffNode & { fields: FlowDiffField[] })[];
  edgesAdded: number;
  edgesRemoved: number;
}

/** A flow on this server imported from an earlier version of the same template, compared with the file being imported. */
export interface FlowTemplateUpdate {
  flowId: number;
  flowName: string;
  enabled: boolean;
  installedVersion: string;
  /** How the file's version compares to the installed one. */
  relation: 'newer' | 'same' | 'older';
  /** The major version differs: the inputs must be mapped again, `values` is empty. */
  major: boolean;
  /** Input values taken from the installed flow, to start the mapping with. */
  values: Record<string, string>;
  /** The installed version's file as it was imported; null when it was not kept (imported before versions were stored). */
  againstPrevious: FlowDiff | null;
  /** The installed flow (with local edits) against the new version with the same values. */
  againstLocal: FlowDiff;
  /** What the new version can do that the installed flow cannot. */
  newCapabilities: FlowCapability[];
}
