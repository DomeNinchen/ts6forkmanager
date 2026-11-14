// Approval of imported flows (R16 decision 9, made server-side): only an admin switches an imported flow
// on, and a later change of what it does by a non-admin needs the admin again.
import { normalizeFlowData } from '../bot-engine/normalize-flow.js';

/** JSON with object keys sorted, so the same settings in another key order give the same text. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * What a flow does, read from the form the engine runs (editor and engine format alike): node types and
 * data plus the wiring. Node positions, node labels, edge ids and edge labels do not count.
 */
export function flowLogicKey(flowData: unknown): string {
  let flow;
  try {
    flow = normalizeFlowData(flowData ?? {});
  } catch {
    return `raw:${stableJson(flowData)}`; // the engine cannot load it either; any change counts
  }
  const nodes = flow.nodes
    .map((n) => {
      const { label: _label, ...data } = n.data ?? {};
      return stableJson({ id: n.id, type: n.type, data });
    })
    .sort();
  const edges = flow.edges.map((e) => stableJson([e.source, e.target, e.sourceHandle ?? null])).sort();
  return `[${nodes.join(',')}]|[${edges.join(',')}]`;
}

/**
 * The flowData to store on a write. `imported` belongs to the server: an existing flow keeps the one it has
 * (whatever the request says), a new flow made through the normal create route gets none.
 */
export function withStoredImport(incoming: Record<string, unknown>, stored: Record<string, unknown> | null): Record<string, unknown> {
  const { imported: _ignored, ...rest } = incoming;
  const keep = stored?.imported;
  if (!keep || typeof keep !== 'object') return rest;
  const { approved: _old, ...ref } = keep as Record<string, unknown>;
  return { ...rest, imported: ref };
}
