import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { StreamSignaling, summarizeCandidate, summarizeSdp } from './stream-signaling.js';
import { setDebugFlag } from '../../utils/debug-flags.js';

const fakePrisma = { appSetting: { upsert: async () => ({}) } } as any;
const SDP = [
  'v=0',
  'c=IN IP4 203.0.113.7',
  'a=candidate:1 1 UDP 2130706431 192.168.1.50 50000 typ host',
  'a=candidate:2 1 udp 1694498815 203.0.113.7 50001 typ srflx raddr 192.168.1.50 rport 50000',
  'a=candidate:3 1 udp 2130706431 172.18.0.5 50002 typ host',
].join('\r\n');

let lines: string[];
let originalLog: typeof console.log;
let client: EventEmitter & { sendCommand: (c: string) => void };
let signaling: StreamSignaling;

beforeEach(() => {
  lines = [];
  originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  client = Object.assign(new EventEmitter(), { sendCommand: () => {} });
  signaling = new StreamSignaling(client as any);
});

afterEach(async () => {
  console.log = originalLog;
  await setDebugFlag(fakePrisma, 'streamSignaling', false);
});

const signal = (json: string) =>
  client.emit('command', { name: 'notifystreamsignaling', params: { clid: '7', id: 's1', json } });

test('summaries keep type, protocol and port but no IP address', () => {
  assert.equal(summarizeCandidate('candidate:2 1 UDP 1694498815 203.0.113.7 50001 typ srflx raddr 192.168.1.50 rport 50000'), 'srflx udp x.x.x.x:50001');
  assert.equal(summarizeCandidate('garbage'), 'unparsed candidate (7 chars)');
  assert.equal(summarizeCandidate(undefined), 'empty candidate');
  assert.equal(summarizeSdp(SDP), `SDP ${SDP.length} chars, 3 candidates (host 2, srflx 1)`);
  assert.equal(summarizeSdp(undefined), 'no SDP');
});

test('flag off: nothing is logged, the answer still reaches the listener', () => {
  const got: any[] = [];
  signaling.on('signalingMessage', (m) => got.push(m));
  signal(JSON.stringify({ cmd: 'answer', args: { answer: SDP } }));
  signal(JSON.stringify({ cmd: 'somethingNew', args: {} }));
  assert.deepEqual(lines, []);
  assert.equal(got.length, 1);
  assert.equal(got[0].type, 'answer');
  assert.equal(got[0].clid, 7);
});

test('flag on: incoming, unknown, empty and outgoing messages are logged without addresses', async () => {
  await setDebugFlag(fakePrisma, 'streamSignaling', true);
  signal(JSON.stringify({ cmd: 'answer', args: { answer: SDP } }));
  signal(JSON.stringify({ cmd: 'iceCandidate', args: { sdp: 'candidate:1 1 udp 2130706431 192.168.1.50 50000 typ host', mid: '0', mLine: 0 } }));
  signal(JSON.stringify({ cmd: 'somethingNew', args: { foo: 1 } }));
  client.emit('command', { name: 'notifystreamsignaling', params: { clid: '7', id: 's1' } });
  client.emit('command', { name: 'notifyjoinstreamrequest', params: { clid: '7', id: 's1' } });
  client.emit('command', { name: 'notifystreamweird', params: { clid: '7' } });
  client.emit('command', { name: 'notifyclientmoved', params: { clid: '7' } });
  signaling.sendJoinResponse(7, 's1', true, SDP);

  assert.deepEqual(lines, [
    `[StreamSignaling] <- streamsignaling clid=7 id=s1 cmd=answer SDP ${SDP.length} chars, 3 candidates (host 2, srflx 1)`,
    '[StreamSignaling] <- streamsignaling clid=7 id=s1 cmd=iceCandidate host udp x.x.x.x:50000 mid=0 mLine=0',
    '[StreamSignaling] <- streamsignaling clid=7 id=s1 cmd=somethingNew not handled (args: foo)',
    '[StreamSignaling] <- streamsignaling clid=7 id=s1 with an empty payload (ignored)',
    '[StreamSignaling] <- notifyjoinstreamrequest clid=7 id=s1',
    '[StreamSignaling] <- notifystreamweird clid=7 id=- (not handled)',
    `[StreamSignaling] -> respondjoinstreamrequest clid=7 id=s1 decision=1 SDP ${SDP.length} chars, 3 candidates (host 2, srflx 1)`,
  ]);
  assert.ok(!lines.join('\n').match(/\d+\.\d+\.\d+\.\d+/), 'no IPv4 address in the log');
});
