// Pure functions for the shareable flow template file (types/flow-template.ts):
// turning a flow into a template (export), checking an uploaded file, and
// turning a template back into a flow (import). Used by the backend routes and
// by the import dialog, so both report the same problems.

import { isReadOnlyCommand, isSecretKey } from '../serverquery/classification.js';
import {
  FLOW_TEMPLATE_FORMAT, FLOW_TEMPLATE_FORMAT_VERSION, FLOW_TEMPLATE_INPUT_TYPES, FLOW_TEMPLATE_MAX_BYTES,
  FLOW_TEMPLATE_MAX_INPUTS, FLOW_TEMPLATE_MAX_NODES, FLOW_TEMPLATE_OBJECT_TYPES,
  type FlowCapability, type FlowCapabilityKind, type FlowTemplateEdge, type FlowTemplateFile, type FlowTemplateInput, type FlowTemplateInputType,
  type FlowTemplateNode, type FlowTemplateTarget, type FlowTemplateWarning, type ImportedTemplateRef,
} from '../types/flow-template.js';

/** Every node type the flow editor can place (BotEditor NODE_TYPES); anything else in a file is refused. */
export const FLOW_EDITOR_NODE_TYPES: readonly string[] = [
  'trigger_event', 'trigger_cron', 'trigger_webhook', 'trigger_command', 'trigger_support',
  'condition', 'delay', 'variable', 'log', 'loop',
  'action_message', 'action_poke', 'action_kick', 'action_ban', 'action_move',
  'action_channelCreate', 'action_channelEdit', 'action_channelDelete', 'action_groupAdd', 'action_groupRemove',
  'action_webquery', 'action_webhook', 'action_httpRequest',
  'action_voicePlay', 'action_voiceStop', 'action_voiceJoinChannel', 'action_voiceLeaveChannel', 'action_voiceVolume',
  'action_voicePauseResume', 'action_voiceSkip', 'action_voiceSeek', 'action_voiceTts',
  'action_afkMover', 'action_idleKicker', 'action_pokeGroup', 'action_rankCheck', 'action_tempChannelCleanup',
  'action_supportEnqueue', 'action_animatedChannel', 'action_generateCode', 'action_countOnlineInGroups', 'action_listMembership',
];

interface IdField { field: string; type: FlowTemplateInputType; multiple?: boolean }

const CHANNEL = (field: string, multiple?: boolean): IdField => ({ field, type: 'channel', multiple });
const GROUP = (field: string, multiple?: boolean): IdField => ({ field, type: 'servergroup', multiple });
const BOT: IdField = { field: 'botId', type: 'bot' };

/** Node settings that hold an id of a server object (editor format, see normalizeFlowData). */
const ID_FIELDS: Record<string, IdField[]> = {
  trigger_command: [CHANNEL('channelId')],
  action_move: [CHANNEL('channelId'), CHANNEL('cid')],
  action_channelCreate: [CHANNEL('cpid'), CHANNEL('params.cpid')],
  action_channelEdit: [CHANNEL('channelId'), CHANNEL('cid')],
  action_channelDelete: [CHANNEL('channelId'), CHANNEL('cid')],
  action_groupAdd: [GROUP('groupId')],
  action_groupRemove: [GROUP('groupId')],
  action_pokeGroup: [GROUP('groupId')],
  action_afkMover: [CHANNEL('afkChannelId'), GROUP('exemptGroupIds', true), CHANNEL('exemptChannelIds', true)],
  action_idleKicker: [GROUP('exemptGroupIds', true)],
  action_rankCheck: [GROUP('excludeGroupIds', true)],
  action_tempChannelCleanup: [CHANNEL('parentChannelId'), CHANNEL('protectedChannelIds', true)],
  action_animatedChannel: [CHANNEL('channelId')],
  action_countOnlineInGroups: [GROUP('groupIds', true), CHANNEL('excludeChannelIds', true)],
  action_voicePlay: [BOT], action_voiceStop: [BOT], action_voiceLeaveChannel: [BOT], action_voiceVolume: [BOT],
  action_voicePauseResume: [BOT], action_voiceSkip: [BOT], action_voiceSeek: [BOT], action_voiceTts: [BOT],
  action_voiceJoinChannel: [BOT, CHANNEL('channelId')],
};

/** WebQuery parameters that name a channel or group (the rest of a raw command is only warned about). */
const WEBQUERY_ID_PARAMS: Record<string, FlowTemplateInputType> = { cid: 'channel', cpid: 'channel', sgid: 'servergroup', cgid: 'channelgroup' };

/** A literal id or comma list of ids - `{{temp.x}}` placeholders are runtime values, not server objects. */
const ID_VALUE = /^\s*\d+(\s*,\s*\d+)*\s*$/;
const TEMPLATE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const INPUT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

export function getConfigPath(config: Record<string, unknown>, path: string): unknown {
  let cur: unknown = config;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setConfigPath(config: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = config;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] === null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Secret-looking setting names; same rule as the change log's field masking. */
export function isSecretConfigKey(key: string): boolean {
  const k = key.toLowerCase();
  if (isSecretKey(k)) return true;
  // `channel_flag_password` is a 0/1 flag, not a secret.
  return /(?:password|secret|apikey|api_key|privatekey|token|passphrase)$/.test(k) && k !== 'channel_flag_password';
}

/** Header values that never carry a credential; every other header value is emptied on export. */
const HARMLESS_HEADERS: ReadonlySet<string> = new Set(['content-type', 'accept', 'accept-language', 'user-agent']);

/** key=value pairs in a URL query or a form body whose key is secret-looking get an empty value. */
function blankSecretPairs(text: string): string {
  return text.replace(/(^|[?&])([^=&#?\s]+)=([^&#]*)/g, (pair, sep: string, key: string, value: string) =>
    value !== '' && isSecretConfigKey(decodeURIComponentSafe(key)) ? `${sep}${key}=` : pair);
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function blankSecretKeysDeep(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => { const r = blankSecretKeysDeep(v); changed ||= r.changed; return r.value; });
    return { value: out, changed };
  }
  if (value === null || typeof value !== 'object') return { value, changed: false };
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (isSecretConfigKey(k) && v !== '' && v != null && typeof v !== 'object') { out[k] = ''; changed = true; continue; }
    const r = blankSecretKeysDeep(v);
    out[k] = r.value;
    changed ||= r.changed;
  }
  return { value: out, changed };
}

/**
 * Empties everything secret in the nodes' settings (in place) and returns where:
 * every HTTP header value but HARMLESS_HEADERS, every secret-looking setting at any depth (passwords,
 * webhook secret, tokens in WebQuery params), credentials and secret query
 * parameters in URLs, and secret keys in JSON or form bodies.
 */
export function stripFlowSecrets(nodes: FlowTemplateNode[]): FlowTemplateTarget[] {
  const found: FlowTemplateTarget[] = [];
  for (const node of nodes) {
    const config = node.config;
    const walk = (obj: Record<string, unknown>, prefix: string) => {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (!prefix && key === 'headers' && value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [h, hv] of Object.entries(value as Record<string, unknown>)) {
            if (hv !== '' && hv != null && !HARMLESS_HEADERS.has(h.toLowerCase())) { (value as Record<string, unknown>)[h] = ''; found.push({ node: node.id, field: `headers.${h}` }); }
          }
          continue;
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) { walk(value as Record<string, unknown>, path); continue; }
        if (value === '' || value == null || typeof value === 'object') continue;
        if (isSecretConfigKey(key)) { obj[key] = ''; found.push({ node: node.id, field: path }); continue; }
        if (!prefix && key === 'url' && typeof value === 'string') {
          const cleaned = blankSecretPairs(value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@?#]*@/i, '$1'));
          if (cleaned !== value) { obj[key] = cleaned; found.push({ node: node.id, field: path }); }
          continue;
        }
        if (!prefix && key === 'body' && typeof value === 'string') {
          let cleaned = value;
          try {
            const parsed = JSON.parse(value);
            const r = blankSecretKeysDeep(parsed);
            if (r.changed) cleaned = JSON.stringify(r.value, null, 2);
          } catch {
            cleaned = blankSecretPairs(value);
          }
          if (cleaned !== value) { obj[key] = cleaned; found.push({ node: node.id, field: path }); }
        }
      }
    };
    walk(config, '');
  }
  return found;
}

interface IdCandidate extends FlowTemplateTarget { type: FlowTemplateInputType; multiple?: boolean; value: string; nodeLabel: string }

function idCandidates(nodes: FlowTemplateNode[]): IdCandidate[] {
  const out: IdCandidate[] = [];
  const add = (node: FlowTemplateNode, field: string, type: FlowTemplateInputType, multiple?: boolean) => {
    const v = getConfigPath(node.config, field);
    if ((typeof v === 'string' || typeof v === 'number') && ID_VALUE.test(String(v))) {
      out.push({ node: node.id, field, type, multiple: multiple || String(v).includes(',') || undefined, value: String(v).replace(/\s+/g, ''), nodeLabel: node.label || node.type });
    }
  };
  for (const node of nodes) {
    for (const f of ID_FIELDS[node.type] ?? []) add(node, f.field, f.type, f.multiple);
    if (node.type === 'action_message' && node.config.targetMode === 'channel') add(node, 'target', 'channel');
    if (node.type === 'action_webquery') {
      for (const [param, type] of Object.entries(WEBQUERY_ID_PARAMS)) add(node, `params.${param}`, type);
    }
  }
  return out;
}

/** Places the import cannot map automatically; `skip` are fields already covered by an input. */
export function flowTemplateWarnings(nodes: FlowTemplateNode[], skip: FlowTemplateTarget[] = []): FlowTemplateWarning[] {
  const skipped = new Set(skip.map((t) => `${t.node}\u0000${t.field}`));
  const out: FlowTemplateWarning[] = [];
  const push = (node: FlowTemplateNode, field: string, reason: FlowTemplateWarning['reason']) => {
    if (!skipped.has(`${node.id}\u0000${field}`)) out.push({ node: node.id, field, reason });
  };
  const hasDigit = (v: unknown) => /\d/.test(typeof v === 'string' ? v : JSON.stringify(v ?? ''));
  for (const node of nodes) {
    const c = node.config;
    if (node.type === 'condition' && hasDigit(c.expression)) push(node, 'expression', 'expression');
    if (node.type === 'trigger_event' && c.filters && hasDigit(c.filters)) push(node, 'filters', 'event-filter');
    if (node.type === 'action_rankCheck' && hasDigit(c.ranks)) push(node, 'ranks', 'rank-list');
    if ((node.type === 'trigger_support' || node.type === 'action_supportEnqueue') && c.queueId) push(node, 'queueId', 'support-queue');
    if (node.type === 'action_webquery' && c.params && typeof c.params === 'object') {
      for (const [param, value] of Object.entries(c.params as Record<string, unknown>)) {
        if (!(param in WEBQUERY_ID_PARAMS) && ID_VALUE.test(String(value ?? ''))) push(node, `params.${param}`, 'webquery');
      }
    }
  }
  return out;
}

function cloneNodes(nodes: unknown[]): FlowTemplateNode[] {
  return nodes.map((n: any) => ({
    id: String(n.id), type: String(n.type), label: typeof n.label === 'string' ? n.label : undefined,
    config: JSON.parse(JSON.stringify(n.config ?? {})), x: Number(n.x) || 0, y: Number(n.y) || 0,
  }));
}

function cloneEdges(edges: unknown[]): FlowTemplateEdge[] {
  return edges.map((e: any) => ({
    id: String(e.id), source: String(e.source), sourcePort: e.sourcePort ?? undefined,
    target: String(e.target), targetPort: e.targetPort ?? undefined,
    ...(Array.isArray(e.waypoints) ? { waypoints: e.waypoints.map((p: any) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })) } : {}),
  }));
}

export function templateIdFromName(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return TEMPLATE_ID.test(slug) ? slug : 'flow';
}

export interface FlowTemplateMeta { id?: string; name: string; version?: string; description?: string; author?: string }

/**
 * Turns a flow (editor format) into a template file: ids of server objects
 * become inputs (the same value in several nodes = one input), secrets are
 * emptied. The `warnings` list the places that may still name objects of this
 * server and could not be turned into inputs.
 */
export function flowToTemplate(flowData: { nodes?: unknown[]; edges?: unknown[] }, meta: FlowTemplateMeta): { template: FlowTemplateFile; warnings: FlowTemplateWarning[] } {
  const nodes = cloneNodes(flowData.nodes ?? []);
  const edges = cloneEdges(flowData.edges ?? []);
  const secrets = stripFlowSecrets(nodes);

  const inputs: FlowTemplateInput[] = [];
  const byValue = new Map<string, FlowTemplateInput>();
  const counters: Partial<Record<FlowTemplateInputType, number>> = {};
  for (const c of idCandidates(nodes)) {
    const group = `${c.type}\u0000${c.value}`;
    let input = byValue.get(group);
    if (!input) {
      counters[c.type] = (counters[c.type] ?? 0) + 1;
      // A list (exempt groups, protected channels) may stay empty on the new server.
      input = { key: `${c.type}${counters[c.type]}`, type: c.type, label: `${c.nodeLabel}: ${c.field}`, required: !c.multiple, default: c.value, targets: [] };
      byValue.set(group, input);
      inputs.push(input);
    }
    if (c.multiple) input.multiple = true;
    input.targets.push({ node: c.node, field: c.field });
  }

  const template: FlowTemplateFile = {
    format: FLOW_TEMPLATE_FORMAT,
    formatVersion: FLOW_TEMPLATE_FORMAT_VERSION,
    id: meta.id && TEMPLATE_ID.test(meta.id) ? meta.id : templateIdFromName(meta.name),
    name: meta.name.slice(0, 100),
    version: meta.version && SEMVER.test(meta.version) ? meta.version : '1.0.0',
    ...(meta.description ? { description: meta.description.slice(0, 2000) } : {}),
    ...(meta.author ? { author: meta.author.slice(0, 200) } : {}),
    inputs,
    secrets,
    flow: { nodes, edges },
  };
  return { template, warnings: flowTemplateWarnings(nodes, inputs.flatMap((i) => i.targets)) };
}

export type FlowTemplateCheck = { ok: true; template: FlowTemplateFile } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const optString = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);

/** Bytes, not characters: the size limit is about the file. (common has no TextEncoder typing.) */
function utf8Length(s: string): number {
  if (s.length > FLOW_TEMPLATE_MAX_BYTES) return s.length;
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Checks an uploaded template. `text` is the raw file content (size and JSON are
 * checked here too); errors are short English sentences naming the place.
 */
export function parseFlowTemplate(text: string): FlowTemplateCheck {
  if (utf8Length(text) > FLOW_TEMPLATE_MAX_BYTES) return { ok: false, errors: [`The file is larger than ${FLOW_TEMPLATE_MAX_BYTES / 1024 / 1024} MB.`] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, errors: ['The file is not valid JSON.'] }; }
  return checkFlowTemplate(raw);
}

export function checkFlowTemplate(raw: unknown): FlowTemplateCheck {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['The file does not contain a template object.'] };
  if (raw.format !== FLOW_TEMPLATE_FORMAT) return { ok: false, errors: [`"format" must be "${FLOW_TEMPLATE_FORMAT}" - this is not a flow template file.`] };
  if (!Number.isInteger(raw.formatVersion) || (raw.formatVersion as number) < 1) {
    return { ok: false, errors: ['"formatVersion" must be a whole number of at least 1.'] };
  }
  if ((raw.formatVersion as number) > FLOW_TEMPLATE_FORMAT_VERSION) {
    return { ok: false, errors: [`The template uses format version ${raw.formatVersion}; this manager reads up to version ${FLOW_TEMPLATE_FORMAT_VERSION}. Update the manager first.`] };
  }
  if (typeof raw.id !== 'string' || !TEMPLATE_ID.test(raw.id)) errors.push('"id" must be 1-64 lowercase letters, digits or dashes.');
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 100) errors.push('"name" must be a text of 1-100 characters.');
  if (typeof raw.version !== 'string' || !SEMVER.test(raw.version)) errors.push('"version" must look like 1.0.0 (major.minor.patch).');
  if (!optString(raw.description, 2000)) errors.push('"description" must be a text of at most 2000 characters.');
  if (!optString(raw.author, 200)) errors.push('"author" must be a text of at most 200 characters.');
  if (!optString(raw.source, 200)) errors.push('"source" must be a text of at most 200 characters.');
  if (raw.translations !== undefined) {
    if (!isObj(raw.translations)) errors.push('"translations" must be an object.');
    else for (const [lang, tr] of Object.entries(raw.translations)) {
      if (!['de', 'en', 'fr'].includes(lang)) errors.push(`"translations.${lang}": only de, en and fr are supported.`);
      else if (!isObj(tr) || !optString(tr.name, 100) || !optString(tr.description, 2000)) errors.push(`"translations.${lang}" must hold a name (max 100) and/or description (max 2000).`);
    }
  }

  const flow = raw.flow;
  const nodeIds = new Set<string>();
  if (!isObj(flow) || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    errors.push('"flow" must hold "nodes" and "edges" lists.');
    return { ok: false, errors };
  }
  if (flow.nodes.length === 0) errors.push('The flow has no nodes.');
  if (flow.nodes.length > FLOW_TEMPLATE_MAX_NODES) {
    errors.push(`The flow has ${flow.nodes.length} nodes; at most ${FLOW_TEMPLATE_MAX_NODES} are allowed.`);
    return { ok: false, errors };
  }
  if (flow.edges.length > FLOW_TEMPLATE_MAX_NODES * 4) errors.push(`The flow has more than ${FLOW_TEMPLATE_MAX_NODES * 4} connections.`);
  flow.nodes.forEach((n, i) => {
    const where = `Node ${i + 1}`;
    if (!isObj(n)) { errors.push(`${where} is not an object.`); return; }
    if (typeof n.id !== 'string' || !n.id || n.id.length > 100) errors.push(`${where}: "id" must be a text of 1-100 characters.`);
    else if (nodeIds.has(n.id)) errors.push(`${where}: the id "${n.id}" is used twice.`);
    else nodeIds.add(n.id);
    if (typeof n.type !== 'string' || !FLOW_EDITOR_NODE_TYPES.includes(n.type)) errors.push(`${where}: unknown node type "${String(n.type)}".`);
    if (!isObj(n.config)) errors.push(`${where}: "config" must be an object.`);
    if (!optString(n.label, 200)) errors.push(`${where}: "label" must be a text of at most 200 characters.`);
    if (typeof n.x !== 'number' || typeof n.y !== 'number' || !Number.isFinite(n.x) || !Number.isFinite(n.y)) errors.push(`${where}: "x" and "y" must be numbers.`);
  });
  flow.edges.forEach((e, i) => {
    const where = `Connection ${i + 1}`;
    if (!isObj(e) || typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') { errors.push(`${where} needs "id", "source" and "target".`); return; }
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) errors.push(`${where} points at a node that does not exist.`);
    if (!optString(e.sourcePort, 50) || !optString(e.targetPort, 50)) errors.push(`${where}: ports must be short texts.`);
    if (e.waypoints !== undefined && (!Array.isArray(e.waypoints) || e.waypoints.length > 50 || e.waypoints.some((p) => !isObj(p) || typeof p.x !== 'number' || typeof p.y !== 'number'))) {
      errors.push(`${where}: "waypoints" must be a list of points.`);
    }
  });

  const targetOk = (t: unknown) => isObj(t) && typeof t.node === 'string' && nodeIds.has(t.node) && typeof t.field === 'string' && /^[^.\s][^\s]{0,199}$/.test(t.field)
    && !t.field.split('.').some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype');
  if (!Array.isArray(raw.inputs)) errors.push('"inputs" must be a list (it may be empty).');
  else {
    if (raw.inputs.length > FLOW_TEMPLATE_MAX_INPUTS) errors.push(`At most ${FLOW_TEMPLATE_MAX_INPUTS} inputs are allowed.`);
    const keys = new Set<string>();
    raw.inputs.forEach((inp, i) => {
      const where = `Input ${i + 1}`;
      if (!isObj(inp)) { errors.push(`${where} is not an object.`); return; }
      if (typeof inp.key !== 'string' || !INPUT_KEY.test(inp.key)) errors.push(`${where}: "key" must start with a letter and hold only letters, digits and _.`);
      else if (keys.has(inp.key)) errors.push(`${where}: the key "${inp.key}" is used twice.`);
      else keys.add(inp.key);
      if (!FLOW_TEMPLATE_INPUT_TYPES.includes(inp.type as FlowTemplateInputType)) errors.push(`${where}: unknown type "${String(inp.type)}".`);
      if (typeof inp.label !== 'string' || !inp.label || inp.label.length > 200) errors.push(`${where}: "label" must be a text of 1-200 characters.`);
      if (!optString(inp.default, 2000)) errors.push(`${where}: "default" must be a text.`);
      if (inp.names !== undefined && (!Array.isArray(inp.names) || inp.names.length > 100 || inp.names.some((n) => typeof n !== 'string' || n.length > 200))) {
        errors.push(`${where}: "names" must be a list of texts.`);
      }
      if (inp.type === 'select' && (!Array.isArray(inp.options) || inp.options.length === 0 || inp.options.some((o) => !isObj(o) || typeof o.value !== 'string' || typeof o.label !== 'string'))) {
        errors.push(`${where}: a select input needs "options" with label and value.`);
      }
      if (!Array.isArray(inp.targets) || inp.targets.length === 0 || !inp.targets.every(targetOk)) errors.push(`${where}: "targets" must name existing nodes and a setting.`);
    });
  }
  if (!Array.isArray(raw.secrets) || !raw.secrets.every(targetOk)) errors.push('"secrets" must be a list of existing nodes and settings (it may be empty).');

  return errors.length ? { ok: false, errors } : { ok: true, template: raw as unknown as FlowTemplateFile };
}

/**
 * Builds the flow of an import. `values` (input key -> value) win over each
 * input's default; server objects have no default (see FlowTemplateInput.default).
 * Required inputs left empty are returned in `missing`, object inputs that are
 * not ids in `invalid`.
 */
export function templateToFlowData(template: FlowTemplateFile, values: Record<string, string> = {}): {
  flowData: { nodes: FlowTemplateNode[]; edges: FlowTemplateEdge[]; imported: ImportedTemplateRef };
  missing: string[];
  invalid: string[];
} {
  const nodes = cloneNodes(template.flow.nodes);
  const edges = cloneEdges(template.flow.edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const input of template.inputs) {
    const isObject = FLOW_TEMPLATE_OBJECT_TYPES.includes(input.type);
    const value = (values[input.key] ?? (isObject ? '' : input.default) ?? '').trim();
    if (!value && input.required) missing.push(input.key);
    else if (value && isObject && !(input.multiple ? ID_VALUE : /^\d+$/).test(value)) invalid.push(input.key);
    for (const t of input.targets) {
      const node = byId.get(t.node);
      if (node) setConfigPath(node.config, t.field, value);
    }
  }
  return { flowData: { nodes, edges, imported: { id: template.id, version: template.version, name: template.name } }, missing, invalid };
}

const CAPABILITY_OF: Record<string, FlowCapabilityKind> = {
  action_kick: 'kick', action_idleKicker: 'kick',
  action_ban: 'ban',
  action_move: 'move', action_afkMover: 'move',
  action_poke: 'poke', action_pokeGroup: 'poke',
  action_message: 'message',
  action_groupAdd: 'groups', action_groupRemove: 'groups', action_rankCheck: 'groups',
  action_channelCreate: 'channels', action_channelEdit: 'channels', action_channelDelete: 'channels',
  action_tempChannelCleanup: 'channels', action_animatedChannel: 'channels',
  action_webquery: 'serverquery',
  action_httpRequest: 'http', action_webhook: 'http',
  trigger_webhook: 'webhookTrigger',
  action_supportEnqueue: 'supportQueue',
};

/** The host an HTTP node calls, without credentials; a URL that is only a placeholder is shown as written. */
export function flowUrlHost(url: unknown): string {
  const text = String(url ?? '').trim();
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(text);
  if (!m) return text.slice(0, 80) || '?';
  return m[1].slice(m[1].lastIndexOf('@') + 1) || '?';
}

/**
 * What a flow can do, for the import dialog ("kick, ban, HTTP to example.com, ...").
 * WebQuery nodes count only with a command that changes something; reading is not listed.
 */
export function flowCapabilities(nodes: FlowTemplateNode[]): FlowCapability[] {
  const byKind = new Map<FlowCapabilityKind, FlowCapability>();
  for (const node of nodes) {
    const kind: FlowCapabilityKind | undefined = node.type.startsWith('action_voice') ? 'voice' : CAPABILITY_OF[node.type];
    if (!kind) continue;
    let detail: string | undefined;
    if (kind === 'http') detail = flowUrlHost(node.config.url);
    if (kind === 'serverquery') {
      const command = String(node.config.command ?? '').trim().split(/\s/)[0].toLowerCase();
      // A placeholder command is unknown until it runs, so it counts as a change.
      if (command && !command.includes('{{') && isReadOnlyCommand(command)) continue;
      detail = command || '?';
    }
    let cap = byKind.get(kind);
    if (!cap) { cap = { kind, nodes: [] }; byKind.set(kind, cap); }
    cap.nodes.push(node.id);
    if (detail && !cap.details?.includes(detail)) (cap.details ??= []).push(detail);
  }
  return [...byKind.values()];
}
