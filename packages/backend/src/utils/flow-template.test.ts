import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFlowTemplate, flowCapabilities, flowToTemplate, flowUrlHost, parseFlowTemplate, templateToFlowData,
  FLOW_TEMPLATE_FORMAT_VERSION, FLOW_TEMPLATE_MAX_BYTES, FLOW_TEMPLATE_MAX_NODES,
} from '@ts6/common';

const TOKEN = 'Bearer sk-live-9f8e7d6c5b4a';
const URL_TOKEN = 'q8Zr7Wm2';
const URL_PW = 'hunter2pw';
const BODY_KEY = 'body-api-key-55aa';
const HOOK_SECRET = 'whsec-0123456789';
const CHANNEL_PW = 'chanpw-Secret!';
const QUERY_PW = 'loginpw-77';

function sampleFlow() {
  return {
    template: { id: 'support-system', config: { supportChannelId: '5' } },
    nodes: [
      { id: 'n1', type: 'trigger_webhook', label: 'Hook', config: { path: 'hook', secret: HOOK_SECRET }, x: 0, y: 0 },
      { id: 'n2', type: 'action_move', label: 'Move', config: { channelId: '5' }, x: 200, y: 0 },
      { id: 'n3', type: 'action_channelEdit', label: 'Rename', config: { channelId: '5', channel_name: 'Support', channel_password: CHANNEL_PW }, x: 400, y: 0 },
      { id: 'n4', type: 'action_countOnlineInGroups', label: 'Count', config: { groupIds: '7, 8', excludeChannelIds: '{{temp.afk}}', storeAs: 'n' }, x: 600, y: 0 },
      { id: 'n5', type: 'action_httpRequest', label: 'Call', config: {
        url: `https://user:${URL_PW}@api.example.com/x?token=${URL_TOKEN}&page=2&{{event.clid}}`,
        method: 'POST', headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: BODY_KEY, text: 'hello {{event.client_nickname}}' }),
      }, x: 800, y: 0 },
      { id: 'n6', type: 'action_webquery', label: 'Set owner', config: { command: 'setclientchannelgroup', params: { cgid: '9', cid: '{{temp.lastCreatedChannelId}}', cldbid: '12' } }, x: 1000, y: 0 },
      { id: 'n7', type: 'condition', label: 'Team?', config: { expression: 'hasGroup(7)' }, x: 1200, y: 0 },
      { id: 'n8', type: 'action_webquery', label: 'Login', config: { command: 'clientsetserverquerylogin', params: { client_login_name: 'x', client_login_password: QUERY_PW } }, x: 1400, y: 0 },
      { id: 'n9', type: 'action_voicePlay', label: 'Play', config: { botId: '3', songId: '44' }, x: 1600, y: 0 },
    ],
    edges: [
      { id: 'e1', source: 'n1', sourcePort: 'out', target: 'n2', targetPort: 'in', waypoints: [{ x: 100, y: 50 }] },
      { id: 'e2', source: 'n2', sourcePort: 'out', target: 'n3', targetPort: 'in' },
    ],
  };
}

test('positive control: the sample really carries every secret before export', () => {
  const raw = JSON.stringify(sampleFlow());
  for (const s of [TOKEN, URL_TOKEN, URL_PW, BODY_KEY, HOOK_SECRET, CHANNEL_PW, QUERY_PW]) assert.ok(raw.includes(s), s);
});

test('export removes every secret and lists where', () => {
  const { template } = flowToTemplate(sampleFlow(), { name: 'Support Desk' });
  const text = JSON.stringify(template);
  for (const s of [TOKEN, URL_TOKEN, URL_PW, BODY_KEY, HOOK_SECRET, CHANNEL_PW, QUERY_PW]) assert.ok(!text.includes(s), `leaked ${s}`);
  // Harmless parts stay: header name, other query params, placeholders, body text.
  const n5 = template.flow.nodes.find((n) => n.id === 'n5')!;
  assert.equal(n5.config.url, 'https://api.example.com/x?token=&page=2&{{event.clid}}');
  assert.deepEqual(n5.config.headers, { Authorization: '', 'Content-Type': 'application/json' });
  assert.equal(JSON.parse(n5.config.body as string).text, 'hello {{event.client_nickname}}');
  const fields = template.secrets.map((s) => `${s.node}:${s.field}`).sort();
  assert.deepEqual(fields, ['n1:secret', 'n3:channel_password', 'n5:body', 'n5:headers.Authorization','n5:url', 'n8:params.client_login_password']);
});

test('export turns server ids into inputs, one per object, and warns about the rest', () => {
  const { template, warnings } = flowToTemplate(sampleFlow(), { name: 'Support Desk' });
  assert.equal(template.id, 'support-desk');
  assert.equal(template.version, '1.0.0');
  assert.equal((template as any).template, undefined);
  const byKey = Object.fromEntries(template.inputs.map((i) => [i.key, i]));
  assert.deepEqual(byKey.channel1.targets, [{ node: 'n2', field: 'channelId' }, { node: 'n3', field: 'channelId' }]);
  assert.equal(byKey.channel1.default, '5');
  assert.equal(byKey.servergroup1.default, '7,8');
  assert.equal(byKey.servergroup1.multiple, true);
  assert.deepEqual(byKey.channelgroup1.targets, [{ node: 'n6', field: 'params.cgid' }]);
  assert.deepEqual(byKey.bot1.targets, [{ node: 'n9', field: 'botId' }]);
  assert.equal(template.inputs.length, 4, 'placeholders like {{temp.afk}} are not inputs');
  assert.deepEqual(warnings.map((w) => `${w.node}:${w.field}:${w.reason}`).sort(), ['n6:params.cldbid:webquery', 'n7:expression:expression']);
});

test('round trip: export -> file text -> check -> import gives the original flow (minus secrets)', () => {
  const original = sampleFlow();
  const { template } = flowToTemplate(original, { name: 'Support Desk', author: 'someone' });
  const check = parseFlowTemplate(JSON.stringify(template, null, 2));
  assert.ok(check.ok, check.ok ? '' : check.errors.join('\n'));
  // The import dialog sends a value for every input; mapped onto the same objects here.
  const same = Object.fromEntries(check.template.inputs.map((i) => [i.key, i.default ?? '']));
  const { flowData, missing, invalid } = templateToFlowData(check.template, same);
  assert.deepEqual(missing, []);
  assert.deepEqual(invalid, []);
  assert.deepEqual(flowData.imported, { id: 'support-desk', version: '1.0.0', name: 'Support Desk' });
  assert.deepEqual(flowData.edges, original.edges);
  const strip = (n: any) => ({ ...n, config: { ...n.config } });
  const n2 = flowData.nodes.find((n) => n.id === 'n2')!;
  assert.deepEqual(strip(n2), strip(original.nodes[1]));
  assert.equal(flowData.nodes.find((n) => n.id === 'n4')!.config.groupIds, '7,8');
});

test('import maps input values onto every target; empty required input is reported', () => {
  const { template } = flowToTemplate(sampleFlow(), { name: 'X' });
  const { flowData, missing, invalid } = templateToFlowData(template, { channel1: '42', servergroup1: '11,12', channelgroup1: '3', bot1: '1' });
  assert.deepEqual([missing, invalid], [[], []]);
  assert.equal(flowData.nodes.find((n) => n.id === 'n2')!.config.channelId, '42');
  assert.equal(flowData.nodes.find((n) => n.id === 'n3')!.config.channelId, '42');
  assert.equal(flowData.nodes.find((n) => n.id === 'n4')!.config.groupIds, '11,12');
  assert.equal((flowData.nodes.find((n) => n.id === 'n6')!.config.params as any).cgid, '3');
  assert.deepEqual(templateToFlowData(template, { channel1: '42', channelgroup1: '3', bot1: '  ' }).missing, ['bot1']);
});

test('import never falls back to the ids of the exporting server; lists may stay empty; ids are checked', () => {
  const { template } = flowToTemplate(sampleFlow(), { name: 'X' });
  // Positive control: the file does carry the old ids.
  assert.equal(template.inputs.find((i) => i.key === 'channel1')!.default, '5');
  const { flowData, missing } = templateToFlowData(template, {});
  assert.deepEqual(missing, ['channel1', 'channelgroup1', 'bot1'], 'a list input (servergroup1) is optional');
  assert.equal(flowData.nodes.find((n) => n.id === 'n2')!.config.channelId, '');
  assert.equal(flowData.nodes.find((n) => n.id === 'n4')!.config.groupIds, '');
  const ok = { channel1: '42', channelgroup1: '3', bot1: '1' };
  assert.deepEqual(templateToFlowData(template, { ...ok, channel1: 'abc' }).invalid, ['channel1']);
  assert.deepEqual(templateToFlowData(template, { ...ok, channel1: '1,2' }).invalid, ['channel1'], 'one channel, not a list');
  assert.deepEqual(templateToFlowData(template, { ...ok, servergroup1: '1, 2' }).invalid, []);
  // A text input still uses its default.
  const withText = validTemplate();
  withText.inputs.push({ key: 'greeting', type: 'text', label: 'Greeting', default: 'hi', targets: [{ node: 'n3', field: 'channel_name' }] });
  assert.equal(templateToFlowData(withText, ok).flowData.nodes.find((n) => n.id === 'n3')!.config.channel_name, 'hi');
});

test('capabilities: what the flow can do, with hosts and changing ServerQuery commands', () => {
  const { template } = flowToTemplate(sampleFlow(), { name: 'X' });
  const caps = Object.fromEntries(flowCapabilities(template.flow.nodes).map((c) => [c.kind, c]));
  assert.deepEqual(Object.keys(caps).sort(), ['channels', 'http', 'move', 'serverquery', 'voice', 'webhookTrigger']);
  assert.deepEqual(caps.http.details, ['api.example.com'], 'no credentials in the host');
  assert.deepEqual(caps.serverquery.details, ['setclientchannelgroup', 'clientsetserverquerylogin']);
  assert.deepEqual(caps.channels.nodes, ['n3']);
  // A malicious file: internal address + kick. Reading commands are not listed, placeholder commands are.
  const evil = [
    { id: 'a', type: 'action_httpRequest', config: { url: 'http://127.0.0.1:3001/api/settings' }, x: 0, y: 0 },
    { id: 'b', type: 'action_kick', config: { reasonmsg: 'bye' }, x: 0, y: 0 },
    { id: 'c', type: 'action_webquery', config: { command: 'serverinfo' }, x: 0, y: 0 },
    { id: 'd', type: 'action_webquery', config: { command: '{{event.msg}}' }, x: 0, y: 0 },
  ];
  const ev = Object.fromEntries(flowCapabilities(evil).map((c) => [c.kind, c]));
  assert.deepEqual(ev.http.details, ['127.0.0.1:3001']);
  assert.deepEqual(ev.kick.nodes, ['b']);
  assert.deepEqual(ev.serverquery.nodes, ['d']);
  assert.equal(flowUrlHost('https://u:p@h.example:8080/x?y=1'), 'h.example:8080');
  assert.equal(flowUrlHost('{{var.url}}'), '{{var.url}}');
});

function validTemplate(): any {
  return JSON.parse(JSON.stringify(flowToTemplate(sampleFlow(), { name: 'X' }).template));
}

test('check: refuses broken, too new, too large and unknown things with readable errors', () => {
  const errs = (t: unknown) => { const r = checkFlowTemplate(t); assert.equal(r.ok, false); return (r as any).errors.join('\n'); };
  assert.ok(checkFlowTemplate(validTemplate()).ok);
  assert.match(errs({ hello: 1 }), /not a flow template/);
  assert.match(errs({ ...validTemplate(), formatVersion: FLOW_TEMPLATE_FORMAT_VERSION + 1 }), /Update the manager/);
  const noName = validTemplate(); delete noName.name; delete noName.version;
  assert.match(errs(noName), /"name"/); assert.match(errs(noName), /"version"/);
  const badType = validTemplate(); badType.flow.nodes[0].type = 'action_rmRf';
  assert.match(errs(badType), /unknown node type "action_rmRf"/);
  const badEdge = validTemplate(); badEdge.flow.edges[0].target = 'nope';
  assert.match(errs(badEdge), /node that does not exist/);
  const badTarget = validTemplate(); badTarget.inputs[0].targets = [{ node: 'n2', field: '__proto__.polluted' }];
  assert.match(errs(badTarget), /"targets"/);
  const badNames = validTemplate(); badNames.inputs[0].names = [1];
  assert.match(errs(badNames), /"names"/);
  const dup = validTemplate(); dup.flow.nodes[1].id = 'n1';
  assert.match(errs(dup), /used twice/);
  const many = validTemplate(); many.flow.nodes = Array.from({ length: FLOW_TEMPLATE_MAX_NODES + 1 }, (_, i) => ({ id: `x${i}`, type: 'log', config: {}, x: 0, y: 0 }));
  assert.match(errs(many), /at most 500/);
  const big = parseFlowTemplate(JSON.stringify({ ...validTemplate(), description: 'x'.repeat(FLOW_TEMPLATE_MAX_BYTES) }));
  assert.equal(big.ok, false);
  assert.match((big as any).errors[0], /larger than 1 MB/);
  assert.match((parseFlowTemplate('{nope') as any).errors[0], /not valid JSON/);
});
