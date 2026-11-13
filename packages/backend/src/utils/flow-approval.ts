// Approval of imported flows (R16 decision 9, made server-side): only an admin switches an imported flow
// on, and a later change of what it does by a non-admin needs the admin again.

/** What a flow does: node types and settings plus the wiring. Positions and labels do not count. */
export function flowLogicKey(flowData: unknown): string {
  const f = (flowData ?? {}) as { nodes?: unknown; edges?: unknown };
  const nodes = (Array.isArray(f.nodes) ? f.nodes : [])
    .map((n: any) => ({ id: String(n?.id), type: n?.type ?? null, config: n?.config ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = (Array.isArray(f.edges) ? f.edges : [])
    .map((e: any) => [e?.source, e?.target, e?.sourcePort, e?.targetPort].map((v) => (v == null ? null : String(v))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({ nodes, edges });
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
