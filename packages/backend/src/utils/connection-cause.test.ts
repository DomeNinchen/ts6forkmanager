import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TSApiError } from '../middleware/error-handler.js';
import { classifyWebQueryError } from './connection-cause.js';

// Error shapes as WebQueryClient produces them, measured against a real TS6 server (R10).
const t = (msg: string, code?: string) => new TSApiError(-1, msg, undefined, code);

test('transport errors map to their cause', () => {
  assert.equal(classifyWebQueryError(t('getaddrinfo ENOTFOUND x.invalid', 'ENOTFOUND')).cause, 'dns');
  assert.equal(classifyWebQueryError(t('connect ECONNREFUSED 127.0.0.1:10099', 'ECONNREFUSED')).cause, 'refused');
  assert.equal(classifyWebQueryError(t('timeout of 15000ms exceeded', 'ECONNABORTED')).cause, 'timeout');
  assert.equal(classifyWebQueryError(t('read ECONNRESET', 'ECONNRESET')).cause, 'reset');
  assert.equal(classifyWebQueryError(t("Hostname/IP does not match certificate's altnames", 'ERR_TLS_CERT_ALTNAME_INVALID')).cause, 'tls-name');
  assert.equal(classifyWebQueryError(t('certificate has expired', 'CERT_HAS_EXPIRED')).cause, 'tls-expired');
  assert.equal(classifyWebQueryError(t('unable to verify the first certificate', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')).cause, 'tls-untrusted');
  assert.equal(classifyWebQueryError(t('wrong version number', 'ERR_SSL_WRONG_VERSION_NUMBER')).cause, 'tls-other');
  assert.equal(classifyWebQueryError(t('Request failed with status code 404', 'ERR_BAD_REQUEST')).cause, 'unexpected-response');
  assert.equal(classifyWebQueryError(t('something new', 'EWHATEVER')).cause, 'unknown');
});

test('TeamSpeak answers keep their code', () => {
  const r = classifyWebQueryError(new TSApiError(5122, 'invalid apikey'));
  assert.deepEqual(r, { cause: 'key-rejected', detail: '5122 invalid apikey' });
  assert.equal(classifyWebQueryError(new TSApiError(3329, 'connection failed, you are banned')).cause, 'ts-error');
  assert.equal(classifyWebQueryError(new TSApiError(-1, 'Unexpected response from WebQuery')).cause, 'unexpected-response');
});

test('the detail carries the code and message', () => {
  assert.equal(classifyWebQueryError(t('read ECONNRESET', 'ECONNRESET')).detail, 'ECONNRESET: read ECONNRESET');
});
