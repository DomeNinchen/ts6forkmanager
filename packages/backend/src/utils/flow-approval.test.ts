import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowLogicKey, withStoredImport } from './flow-approval.js';

const flow = {
  nodes: [
    { id: 'a', type: 'trigger_event', label: 'Joined', config: { eventName: 'notifycliententerview' }, x: 10, y: 20 },
    { id: 'b', type: 'action_kick', label: 'Kick', config: { reason: 'bye' }, x: 300, y: 20 },
  ],
  edges: [{ id: 'e1', source: 'a', sourcePort: 'out', target: 'b', targetPort: 'in' }],
};

test('moving or renaming nodes does not change what a flow does', () => {
  const moved = { ...flow, nodes: flow.nodes.map((n) => ({ ...n, x: n.x + 50, label: `${n.label}!` })).reverse() };
  assert.equal(flowLogicKey(moved), flowLogicKey(flow));
});

test('another node type, setting or wire does', () => {
  const key = flowLogicKey(flow);
  assert.notEqual(flowLogicKey({ ...flow, nodes: [flow.nodes[0], { ...flow.nodes[1], config: { reason: 'other' } }] }), key);
  assert.notEqual(flowLogicKey({ ...flow, nodes: [flow.nodes[0], { ...flow.nodes[1], type: 'action_ban' }] }), key);
  assert.notEqual(flowLogicKey({ ...flow, edges: [] }), key);
  assert.notEqual(flowLogicKey({ ...flow, edges: [{ ...flow.edges[0], sourcePort: 'false' }] }), key);
  assert.notEqual(flowLogicKey({ ...flow, nodes: [...flow.nodes, { id: 'c', type: 'log', config: {} }] }), key);
});

test('the request cannot set or drop the import mark, and approved in flowData is ignored', () => {
  const stored = { ...flow, imported: { id: 't', version: '1.0.0', name: 'T', approved: true } };
  // A non-imported flow cannot become one, and an imported one cannot shed it or approve itself.
  assert.equal(withStoredImport({ ...flow, imported: { id: 'x', version: '1', name: 'x', approved: true } }, null).imported, undefined);
  assert.deepEqual(withStoredImport({ ...flow }, stored).imported, { id: 't', version: '1.0.0', name: 'T' });
  assert.deepEqual(withStoredImport({ ...flow, imported: { id: 't', version: '1.0.0', name: 'T', approved: true } }, { ...flow, imported: { id: 't', version: '1.0.0', name: 'T' } }).imported, { id: 't', version: '1.0.0', name: 'T' });
});

// The engine runs a node with data.triggerType/actionType/nodeType as it is (type/config ignored) and an edge's
// sourceHandle before its sourcePort, so the key has to read the same form.
const engineFlow = {
  nodes: [
    { id: 'a', type: 'trigger', position: { x: 10, y: 20 }, data: { triggerType: 'event', label: 'Joined', eventName: 'notifycliententerview' } },
    { id: 'c', type: 'condition', position: { x: 150, y: 20 }, data: { nodeType: 'condition', label: 'Check', expression: 'true' } },
    { id: 'b', type: 'action', position: { x: 300, y: 20 }, data: { actionType: 'kick', label: 'Kick', reasonId: 5, reasonMsg: 'bye' } },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'c' },
    { id: 'e2', source: 'c', target: 'b', sourceHandle: 'true', label: 'yes' },
  ],
};
const withNode = (f: typeof engineFlow, id: string, data: Record<string, unknown>) =>
  ({ ...f, nodes: f.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)) });

test('engine-format nodes: another action, message or reason changes the key', () => {
  const key = flowLogicKey(engineFlow);
  assert.notEqual(flowLogicKey(withNode(engineFlow, 'b', { actionType: 'ban' })), key);
  assert.notEqual(flowLogicKey(withNode(engineFlow, 'b', { reasonMsg: 'other' })), key);
  assert.notEqual(flowLogicKey(withNode(engineFlow, 'c', { expression: 'false' })), key);
  // type/config next to engine data are ignored by the engine, so changing only them is no change
  assert.equal(flowLogicKey({ ...engineFlow, nodes: engineFlow.nodes.map((n) => ({ ...n, config: { reason: 'x' } })) }), key);
});

test('another branch (sourceHandle) changes the key, also over a matching sourcePort', () => {
  const key = flowLogicKey(engineFlow);
  const branch = (e: Record<string, unknown>) => ({ ...engineFlow, edges: [engineFlow.edges[0], { ...engineFlow.edges[1], ...e }] });
  assert.notEqual(flowLogicKey(branch({ sourceHandle: 'false' })), key);
  assert.notEqual(flowLogicKey(branch({ sourceHandle: 'false', sourcePort: 'true' })), key);
});

test('moving, renaming, relabelling edges and reordering do not change the key', () => {
  const moved = {
    nodes: engineFlow.nodes.map((n) => ({ ...n, x: 999, y: 1, position: { x: n.position.x + 50, y: 7 }, data: { ...n.data, label: `${n.data.label}!` } })).reverse(),
    edges: engineFlow.edges.map((e) => ({ ...e, id: `${e.id}x`, label: 'renamed' })).reverse(),
  };
  assert.equal(flowLogicKey(moved), flowLogicKey(engineFlow));
  // data.position is a setting (voiceSeek's seek target), not the node's place on the canvas
  const seek = { nodes: [{ id: 's', type: 'action', data: { actionType: 'voiceSeek', botId: '1', position: '10' } }], edges: [] };
  assert.notEqual(flowLogicKey(withNode(seek as any, 's', { position: '20' })), flowLogicKey(seek));
});

test('the same flow in editor and engine format has the same key, mixed nodes too', () => {
  const editor = {
    nodes: [
      { id: 'a', type: 'trigger_event', label: 'Joined', config: { eventName: 'notifycliententerview' }, x: 10, y: 20 },
      { id: 'c', type: 'condition', label: 'Check', config: { expression: 'true' }, x: 150, y: 20 },
      { id: 'b', type: 'action_kick', label: 'Kick', config: { reasonid: '5', reason: 'bye' }, x: 300, y: 20 },
    ],
    edges: [
      { id: 'e1', source: 'a', sourcePort: 'out', target: 'c', targetPort: 'in' },
      { id: 'e2', source: 'c', sourcePort: 'true', target: 'b', targetPort: 'in' },
    ],
  };
  // the trigger's output port 'out' is a handle the engine sees; engine-side the same edge carries it too
  const engine = { ...engineFlow, edges: [{ ...engineFlow.edges[0], sourceHandle: 'out' }, engineFlow.edges[1]] };
  assert.equal(flowLogicKey(editor), flowLogicKey(engine));
  const mixed = { ...editor, nodes: [editor.nodes[0], engineFlow.nodes[1], editor.nodes[2]] };
  assert.equal(flowLogicKey(mixed), flowLogicKey(engine));
  assert.notEqual(flowLogicKey({ ...mixed, nodes: [editor.nodes[0], withNode(engineFlow, 'c', { expression: 'false' }).nodes[1], editor.nodes[2]] }), flowLogicKey(engine));
});

test('broken input does not throw', () => {
  for (const bad of [null, undefined, {}, { nodes: 'x' }, { nodes: [null] }, { nodes: [{}], edges: [{}] }, { edges: [null] }, 'text', 42]) {
    assert.equal(typeof flowLogicKey(bad), 'string');
  }
  assert.notEqual(flowLogicKey({ nodes: [null] }), flowLogicKey({ nodes: [null, null] }));
});
