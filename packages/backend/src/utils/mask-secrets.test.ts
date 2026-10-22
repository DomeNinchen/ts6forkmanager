import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecrets, maskSecretsInLine } from './mask-secrets.js';

const SECRET = 'S3cr3t-R1';

test('maskSecrets: flat parameters lose the secret, harmless fields stay readable', () => {
  const params = { pw: SECRET, desc: 'note', duration: 600, channel_flag_password: 1 };
  const masked = maskSecrets(params);
  assert.ok(!JSON.stringify(masked).includes(SECRET));
  assert.deepEqual(masked, { pw: '***', desc: 'note', duration: 600, channel_flag_password: 1 });
  // The caller's object is untouched
  assert.equal(params.pw, SECRET);
});

test('maskSecrets: arrays of answers and nested objects are masked at any depth', () => {
  const answer = [
    { nickname: 'serveradmin', pw_clear: SECRET, tcid: '0' },
    { token: SECRET, token_description: 'x' },
    { cid: '1', expires_in: '60', jwt: SECRET },
  ];
  assert.ok(!JSON.stringify(maskSecrets(answer)).includes(SECRET));
  const nested = { body: [{ apikey: SECRET, scope: 'manage', inner: { ftkey: SECRET, port: 30033 } }], status: { code: 0 } };
  const masked = maskSecrets(nested) as any;
  assert.ok(!JSON.stringify(masked).includes(SECRET));
  assert.equal(masked.body[0].inner.port, 30033);
  assert.deepEqual(masked.status, { code: 0 });
});

test('maskSecrets: empty secrets and plain values pass through', () => {
  assert.deepEqual(maskSecrets({ cpw: '', cid: 5 }), { cpw: '', cid: 5 });
  assert.equal(maskSecrets('text'), 'text');
  assert.equal(maskSecrets(null), null);
});

test('maskSecretsInLine: SSH commands and answers lose the secret', () => {
  const command = `ftgetfilelist cid=5 cpw=${SECRET} path=\\/`;
  assert.equal(maskSecretsInLine(command), 'ftgetfilelist cid=5 cpw=*** path=\\/');
  const answer = `clientftfid=1 serverftfid=6 ftkey=${SECRET} port=30033|nickname=a pw_clear=${SECRET} tcid=0`;
  const masked = maskSecretsInLine(answer);
  assert.ok(!masked.includes(SECRET));
  assert.equal(masked, 'clientftfid=1 serverftfid=6 ftkey=*** port=30033|nickname=a pw_clear=*** tcid=0');
});

test('maskSecretsInLine: whole names only, escaped values masked in full', () => {
  assert.equal(maskSecretsInLine('channel_flag_password=1 channel_password=a\\sb\\pc'), 'channel_flag_password=1 channel_password=***');
  assert.equal(maskSecretsInLine('cpw= cid=1'), 'cpw= cid=1');
});
