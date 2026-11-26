import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientStatus } from '../src/lib/client-status.ts';

test('clientStatus: WebQuery strings "0" are off (issue #452)', () => {
  // the values WebQuery sends for an active client
  assert.equal(clientStatus({ client_away: '0', client_input_muted: '0', client_output_muted: '0' }), 'active');
  // positive control: the old truthiness check read "0" as away
  assert.equal(Boolean('0'), true);
});

test('clientStatus: each state, strings and numbers', () => {
  for (const one of ['1', 1, true] as const) {
    assert.equal(clientStatus({ client_away: one, client_input_muted: '0', client_output_muted: '0' }), 'away');
    assert.equal(clientStatus({ client_away: '0', client_input_muted: one, client_output_muted: '0' }), 'muted');
    assert.equal(clientStatus({ client_away: 0, client_input_muted: 0, client_output_muted: one }), 'muted');
  }
});

test('clientStatus: off values and missing fields are active', () => {
  for (const off of ['0', 0, false, '', undefined, null] as const) {
    assert.equal(clientStatus({ client_away: off, client_input_muted: off, client_output_muted: off }), 'active');
  }
  assert.equal(clientStatus({}), 'active');
});

test('clientStatus: away wins over muted', () => {
  assert.equal(clientStatus({ client_away: '1', client_input_muted: '1', client_output_muted: '1' }), 'away');
});
