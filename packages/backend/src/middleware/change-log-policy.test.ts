import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { classifyChange, KNOWN_AREAS, CRITICAL_AREAS } from './change-log-policy.js';
import { changeLogMiddleware } from './change-log.js';

// --- classifyChange unit tests -------------------------------------------------

test('a GET is never logged', () => {
  assert.equal(classifyChange('GET', '/api/servers/3/vs/1/channels').kind, 'skip');
});

test('a channel edit is logged under its area with the ids pulled from the path', () => {
  const d = classifyChange('PUT', '/api/servers/3/vs/1/channels/47');
  assert.equal(d.kind, 'log');
  if (d.kind !== 'log') return;
  assert.equal(d.target.area, 'channels');
  assert.equal(d.target.serverConfigId, 3);
  assert.equal(d.target.virtualServerId, 1);
  assert.equal(d.target.targetId, '47');
  assert.equal(d.target.routePattern, '/servers/:configId/vs/:sid/channels/:id');
  assert.equal(d.target.critical, false);
});

test('a connection and a user change are critical (fail-closed)', () => {
  for (const path of ['/api/servers', '/api/servers/3', '/api/users/5', '/api/servers/3/instance', '/api/settings/oidc']) {
    const d = classifyChange('POST', path);
    assert.equal(d.kind, 'log', path);
    if (d.kind === 'log') assert.equal(d.target.critical, true, path);
  }
});

test('the excluded writing routes are not logged', () => {
  const excluded = { kind: 'skip', reason: 'excluded' };
  assert.deepEqual(classifyChange('PUT', '/api/user-settings/dashboard'), excluded);
  assert.deepEqual(classifyChange('POST', '/api/servers/3/test'), excluded);
  assert.deepEqual(classifyChange('POST', '/api/update-check'), excluded);
  for (const path of ['/api/auth/login', '/api/auth/login/verify-totp', '/api/auth/refresh', '/api/auth/logout']) {
    assert.deepEqual(classifyChange('POST', path), excluded, path);
  }
});

test("a user's own account changes are logged", () => {
  for (const [method, path] of [['PUT', '/api/auth/password'], ['POST', '/api/auth/totp/disable'], ['PUT', '/api/auth/language']]) {
    const d = classifyChange(method, path);
    assert.equal(d.kind, 'log', path);
    if (d.kind === 'log') assert.equal(d.target.area, 'auth', path);
  }
});

test('every critical area is also a known area', () => {
  for (const area of CRITICAL_AREAS) assert.ok(KNOWN_AREAS.has(area), area);
});

test('a privilege key or temporary password in the path never reaches the row', () => {
  // A word and an all-digit value: the second would otherwise have passed as ":id" and target id.
  for (const secret of ['AbC+dEf/gHi=', 'hunter2', '482913']) {
    const encoded = encodeURIComponent(secret);
    const token = classifyChange('DELETE', `/api/servers/1/vs/1/tokens/${encoded}`);
    const pw = classifyChange('DELETE', `/api/servers/1/vs/1/tokens/temp-passwords/${encoded}`);
    assert.equal(token.kind === 'log' && token.target.routePattern, '/servers/:configId/vs/:sid/tokens/:token');
    assert.equal(pw.kind === 'log' && pw.target.routePattern, '/servers/:configId/vs/:sid/tokens/temp-passwords/:pw');
    for (const d of [token, pw]) {
      assert.ok(!JSON.stringify(d).includes(encoded) && !JSON.stringify(d).includes(secret), `${secret} leaked: ${JSON.stringify(d)}`);
      if (d.kind === 'log') assert.equal(d.target.targetId, null);
    }
  }
  // Creating a temporary password is not mistaken for deleting a key called "temp-passwords".
  const create = classifyChange('POST', '/api/servers/1/vs/1/tokens/temp-passwords');
  assert.equal(create.kind === 'log' && create.target.routePattern, '/servers/:configId/vs/:sid/tokens/temp-passwords');
});

// --- Coverage: no writing route escapes the middleware -------------------------
// Build the real app, capturing every top-level mount in order (app.use's path +
// handlers). A router mount is covered when the change-log middleware was mounted
// earlier on a prefix of its path; then its area must be known (or excluded). A
// writing router that is not covered must be one of the deliberate public ones.
// shortcut: only app.use-mounted routers are checked, not app.get/app.all routes added directly (today only the health check and the public bot webhook); upgrade if a writing route is ever added that way.

const appProto = express.application as any;
const originalUse = appProto.use;
const mounts: { order: number; path: string; handle: any }[] = [];
let order = 0;
appProto.use = function (...args: any[]) {
  const path = typeof args[0] === 'string' ? args[0] : '/';
  for (const handle of typeof args[0] === 'string' ? args.slice(1) : args) mounts.push({ order: order++, path, handle });
  return originalUse.apply(this, args);
};
// Importing the app creates the music folders at MUSIC_DIR (voice/audio/media-dirs.ts), /data/music by
// default - not writable on a CI runner. The test only needs the routes, so they go to a temp dir; the
// import is dynamic because a static one would run before this line.
let tempMusicDir: string | null = null;
if (!process.env.MUSIC_DIR) {
  tempMusicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-change-log-test-'));
  process.env.MUSIC_DIR = tempMusicDir;
}
after(() => { if (tempMusicDir) fs.rmSync(tempMusicDir, { recursive: true, force: true }); });
const { createApp } = await import('../app.js');
// createApp is only called here (importing it mounts nothing), so the patch is in place in time.
try {
  createApp();
} finally {
  appProto.use = originalUse;
}

const MUTATING = ['post', 'put', 'patch', 'delete'];
const isRouter = (handle: any): boolean => typeof handle === 'function' && Array.isArray(handle.stack);
function hasMutatingLeaf(router: any): boolean {
  const walk = (stack: any[]): boolean =>
    stack.some((layer) => {
      if (layer.route) return MUTATING.some((m) => layer.route.methods?.[m]);
      if (layer.handle && Array.isArray(layer.handle.stack)) return walk(layer.handle.stack);
      return false;
    });
  return walk(router.stack);
}
const underPrefix = (path: string, prefix: string) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);

/** Writing routers that are public on purpose (no signed-in user to attribute a change to). */
const PUBLIC_PREFIXES = ['/api/setup', '/api/widget', '/api/file-downloads'];

test('the change-log middleware is mounted in front of the routers', () => {
  assert.ok(mounts.some((m) => m.handle === changeLogMiddleware && m.path === '/api'), 'global mount missing');
  assert.ok(mounts.some((m) => m.handle === changeLogMiddleware && m.path === '/api/auth'), '/api/auth mount missing');
});

test('every writing router mount is covered by the change log or explicitly exempt', () => {
  const logMounts = mounts.filter((m) => m.handle === changeLogMiddleware);
  const publicUnlisted: string[] = [];
  const unclassified: string[] = [];
  for (const m of mounts) {
    if (!isRouter(m.handle) || !hasMutatingLeaf(m.handle)) continue;
    const covered = logMounts.some((l) => l.order < m.order && underPrefix(m.path, l.path));
    if (!covered) {
      if (!PUBLIC_PREFIXES.includes(m.path)) publicUnlisted.push(m.path);
      continue;
    }
    const decision = classifyChange('POST', `${m.path}/1`);
    const ok =
      (decision.kind === 'skip' && decision.reason === 'excluded') ||
      (decision.kind === 'log' && KNOWN_AREAS.has(decision.target.area));
    if (!ok) unclassified.push(`${m.path} -> ${decision.kind === 'log' ? `area ${decision.target.area}` : decision.reason}`);
  }

  assert.deepEqual(publicUnlisted, [], `Writing mount(s) the change log never sees; mount it in front or add to PUBLIC_PREFIXES: ${publicUnlisted.join(', ')}`);
  assert.deepEqual(unclassified, [], `Writing mount(s) with no known change-log area; classify them in change-log-policy.ts: ${unclassified.join(', ')}`);
});

// A path parameter named like a secret must not carry its value into a row. Every writing route
// of every covered router is filled in with a marker for such a parameter (once as text, once as
// digits) and must come out without it. Routes of routers nested inside another router are
// skipped: their mount path inside the parent is not readable from Express.
const SECRET_PARAM_NAME = /token|pw|pass|secret|key/i;

test('no path parameter named like a secret reaches a row', () => {
  const logMounts = mounts.filter((m) => m.handle === changeLogMiddleware);
  const checked: string[] = [];
  const leaked: string[] = [];
  for (const m of mounts) {
    if (!isRouter(m.handle) || !logMounts.some((l) => l.order < m.order && underPrefix(m.path, l.path))) continue;
    for (const layer of m.handle.stack) {
      if (!layer.route || typeof layer.route.path !== 'string') continue;
      const full = `${m.path}${layer.route.path === '/' ? '' : layer.route.path}`;
      const params = full.match(/:[A-Za-z]+/g) ?? [];
      if (!params.some((p) => SECRET_PARAM_NAME.test(p))) continue;
      for (const method of MUTATING.filter((x) => layer.route.methods?.[x]).map((x) => x.toUpperCase())) {
        for (const marker of ['Zq7SecretMarker', '7319468250']) {
          const url = full.replace(/:[A-Za-z]+/g, (p) => (SECRET_PARAM_NAME.test(p) ? marker : '3'));
          const decision = classifyChange(method, url);
          checked.push(`${method} ${full}`);
          if (JSON.stringify(decision).includes(marker)) leaked.push(`${method} ${full} -> ${JSON.stringify(decision)}`);
        }
      }
    }
  }
  assert.ok(checked.some((c) => c.includes('/tokens/:token')), 'the token route was not found - did the router layout change?');
  assert.deepEqual(leaked, [], `Add the parameter to SECRET_PATH_PARAMS in change-log-policy.ts: ${leaked.join('; ')}`);
});
