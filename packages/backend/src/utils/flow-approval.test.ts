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
