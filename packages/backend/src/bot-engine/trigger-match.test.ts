import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventFilterMismatch, matchCommand, supportQueueMismatch, webhookEventData, webhookSecretFrom, webhookSecretMatches } from './trigger-match.js';

const cmd = (extra: object = {}) => ({ triggerType: 'command' as const, label: '', commandPrefix: '!', commandName: 'hilfe', ...extra });

test('event filters: all must match exactly, the first miss is named', () => {
  const trigger = { triggerType: 'event' as const, label: '', eventName: 'notifycliententerview', filters: { client_type: '0', ctid: '5' } };
  assert.equal(eventFilterMismatch(trigger, { client_type: '0', ctid: '5', clid: '3' }), null);
  assert.deepEqual(eventFilterMismatch(trigger, { client_type: '0', ctid: '7' }), { key: 'ctid', expected: '5', actual: '7' });
  assert.deepEqual(eventFilterMismatch(trigger, { client_type: '0' }), { key: 'ctid', expected: '5', actual: null });
  assert.equal(eventFilterMismatch({ ...trigger, filters: undefined }, {}), null);
});

test('command: prefix, word boundary, arguments with several spaces', () => {
  const m = matchCommand(cmd(), { msg: '!hilfe  abc   def', invokerid: '12', invokername: 'Max' });
  assert.ok('data' in m);
  assert.equal(m.data.command_args, 'abc   def');
  assert.equal(m.data.command_args_list, '["abc","def"]');
  assert.equal(m.data.command_args_length, '2');
  assert.equal(m.data.command_name, 'hilfe');
  assert.equal(m.data.clid, '12'); // invoker fallback
  assert.deepEqual(matchCommand(cmd(), { msg: '!hilfeabc' }), { mismatch: 'command' });
  assert.deepEqual(matchCommand(cmd(), { msg: '?hilfe' }), { mismatch: 'command' });
  assert.ok('data' in matchCommand(cmd({ commandPrefix: '' }), { msg: '!hilfe' })); // an empty prefix means '!'
  assert.ok('data' in matchCommand(cmd({ commandPrefix: '#' }), { msg: '#hilfe x' }));
  const none = matchCommand(cmd(), { msg: '!hilfe' });
  assert.ok('data' in none && none.data.command_args === '' && none.data.command_args_length === '0');
  // An existing clid wins over the invoker fields.
  const own = matchCommand(cmd(), { msg: '!hilfe', clid: '4', invokerid: '12' });
  assert.ok('data' in own && own.data.clid === '4');
});

test('command: channel-bound triggers only take their own listener, unbound ones only the base connection', () => {
  const bound = cmd({ channelId: '9' });
  assert.deepEqual(matchCommand(bound, { msg: '!hilfe' }), { mismatch: 'listener' });
  assert.deepEqual(matchCommand(bound, { msg: '!hilfe', __cmd_listener_channel_id: '8' }), { mismatch: 'listener' });
  const ok = matchCommand(bound, { msg: '!hilfe', __cmd_listener_channel_id: '9' });
  assert.ok('data' in ok && ok.data.command_channel_id === '9');
  assert.deepEqual(matchCommand(cmd(), { msg: '!hilfe', __cmd_listener_channel_id: '9' }), { mismatch: 'listener' });
  const base = matchCommand(cmd(), { msg: '!hilfe', target: '3' });
  assert.ok('data' in base && base.data.command_channel_id === '3');
});

test('webhook data keeps body and query but never the secret', () => {
  const d = webhookEventData('a/b', 'POST', { x: { y: 1 } }, { secret: 's3cret', page: '2' });
  assert.deepEqual(d, { webhook_path: 'a/b', webhook_method: 'POST', webhook_body: '{"x":{"y":1}}', webhook_query: '{"page":"2"}' });
  assert.equal(webhookEventData('p', 'GET', undefined, {}).webhook_body, '{}');
});

test('support trigger: no queue chosen = every queue; a chosen one ignores the others', () => {
  const trigger = { triggerType: 'support' as const, label: '', supportEvent: 'taken' as const };
  assert.equal(supportQueueMismatch(trigger, { queue_id: '7' }), null);
  assert.equal(supportQueueMismatch({ ...trigger, queueId: '' }, { queue_id: '7' }), null);
  assert.equal(supportQueueMismatch({ ...trigger, queueId: '7' }, { queue_id: '7' }), null);
  assert.deepEqual(supportQueueMismatch({ ...trigger, queueId: '7' }, { queue_id: '8' }), { key: 'queue_id', expected: '7', actual: '8' });
});

test('webhook secret: equal matches, anything else (wrong, other length, empty) does not', () => {
  assert.equal(webhookSecretMatches('s3cret-value', 's3cret-value'), true);
  assert.equal(webhookSecretMatches('s3cret-value', 's3cret-valuX'), false);
  assert.equal(webhookSecretMatches('s3cret-value', 's3cret'), false);
  assert.equal(webhookSecretMatches('s3cret-value', 's3cret-value-longer'), false);
  assert.equal(webhookSecretMatches('s3cret-value', ''), false);
  // A trigger without a secret never fires, not even for an empty one sent.
  assert.equal(webhookSecretMatches('', ''), false);
  assert.equal(webhookSecretMatches('', 'x'), false);
});

test('webhook secret source: header wins, ?secret= only while allowed and then marked', () => {
  assert.deepEqual(webhookSecretFrom('h', 'q', true), { secret: 'h', viaQuery: false });
  assert.deepEqual(webhookSecretFrom('h', undefined, false), { secret: 'h', viaQuery: false });
  assert.deepEqual(webhookSecretFrom(undefined, 'q', true), { secret: 'q', viaQuery: true });
  assert.deepEqual(webhookSecretFrom('', 'q', true), { secret: 'q', viaQuery: true });
  assert.deepEqual(webhookSecretFrom(undefined, 'q', false), { secret: '', viaQuery: false });
  // ?secret=a&secret=b arrives as an array: not a secret at all.
  assert.deepEqual(webhookSecretFrom(undefined, ['a', 'b'], true), { secret: '', viaQuery: false });
  assert.deepEqual(webhookSecretFrom(undefined, undefined, true), { secret: '', viaQuery: false });
});
