import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * The whole access matrix of the API: every route of the real app, called as every role, through
 * the real middleware chain (login check, change log, server access, the mount gates and every
 * role check inside the routers). Only the last handler of each route is swapped for a stub that
 * answers 299, so "reached the handler" (= allowed) is told apart from a refusal without touching
 * TeamSpeak, and the database is a stand-in that knows the test users and one server grant.
 *
 * The result must equal access-matrix.snapshot.json. A route that is new, gone, or answers
 * differently for any role fails the test - so no route can appear without someone deciding (and
 * the reviewer seeing in the snapshot diff) who may call it. To accept an intended change, run the
 * test with ACCESS_MATRIX_UPDATE=1 and review the snapshot diff.
 */

const SNAPSHOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'access-matrix.snapshot.json');
const ROLES = ['admin', 'viewer', 'bot-operator', 'music-operator', 'server-admin', 'moderator'] as const;
const GRANTED_CONFIG = 1;
const FOREIGN_CONFIG = 2;
const REACHED = 299;

// --- Build the real app, capturing every top-level mount -----------------------------------------
const appProto = express.application as any;
const originalUse = appProto.use;
const mounts: { path: string; handle: any }[] = [];
appProto.use = function (...args: any[]) {
  const p = typeof args[0] === 'string' ? args[0] : '/';
  for (const handle of typeof args[0] === 'string' ? args.slice(1) : args) mounts.push({ path: p, handle });
  return originalUse.apply(this, args);
};
// A router mounted inside another router (clients -> /database, ...) keeps no readable mount path,
// so the paths are recorded as the routers are built, while the app module is imported.
const routerProto = (express.Router as any).prototype;
const originalRouterUse = routerProto.use;
const nestedPath = new Map<any, string>();
routerProto.use = function (...args: any[]) {
  if (typeof args[0] === 'string') for (const h of args.slice(1)) nestedPath.set(h, args[0]);
  return originalRouterUse.apply(this, args);
};
// See change-log-policy.test.ts: importing the app creates the music folders at MUSIC_DIR.
let tempMusicDir: string | null = null;
if (!process.env.MUSIC_DIR) {
  tempMusicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-access-matrix-'));
  process.env.MUSIC_DIR = tempMusicDir;
}
const { createApp } = await import('../app.js');
let app: express.Express;
try {
  app = createApp();
} finally {
  appProto.use = originalUse;
  routerProto.use = originalRouterUse;
}

// --- Collect the routes and stub their handlers --------------------------------------------------
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const routes: { method: string; path: string }[] = [];
const isRouter = (h: any) => typeof h === 'function' && Array.isArray(h.stack);
const seenRouters = new Set<any>();
function collect(router: any, prefix: string): void {
  if (seenRouters.has(router)) return;
  seenRouters.add(router);
  for (const layer of router.stack) {
    if (isRouter(layer.handle)) {
      const sub = nestedPath.get(layer.handle);
      assert.ok(sub !== undefined, `a nested router under ${prefix} has no recorded mount path`);
      collect(layer.handle, `${prefix}${sub}`);
      continue;
    }
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    const stack = layer.route.stack;
    stack[stack.length - 1].handle = (_req: any, res: any) => res.status(REACHED).end();
    const full = `${prefix}${layer.route.path === '/' ? '' : layer.route.path}`;
    for (const method of METHODS.filter((x) => layer.route.methods?.[x])) routes.push({ method: method.toUpperCase(), path: full });
  }
}
for (const m of mounts) if (isRouter(m.handle)) collect(m.handle, m.path);

// --- A database stand-in: users 1-4 have the four roles, each granted server connection 1 only ---
const roleOfUser = (id: number) => ROLES[id - 1];
const model = (name: string) => new Proxy({}, {
  get: (_t, op: string) => async (args: any) => {
    if (name === 'user' && op === 'findUnique') return roleOfUser(args.where.id) ? { enabled: true, role: roleOfUser(args.where.id) } : null;
    if (name === 'userServerAccess' && op === 'findUnique') {
      const w = args.where.userId_serverConfigId;
      return w && w.serverConfigId === GRANTED_CONFIG ? { id: 1, ...w } : null;
    }
    // The music bot / playlist with id 3 (what concrete() fills in) belongs to the granted connection.
    if (name === 'musicBot' && op === 'findUnique') return { id: 3, serverConfigId: GRANTED_CONFIG };
    if (name === 'playlist' && op === 'findUnique') return { id: 3, musicBotId: 3 };
    if (op === 'findMany') return [];
    if (op === 'count') return 0;
    if (op === 'create' || op === 'update' || op === 'upsert') return { id: 1 };
    if (op === 'createMany' || op === 'updateMany' || op === 'deleteMany') return { count: 0 };
    return null;
  },
});
app.locals.prisma = new Proxy({}, { get: (_t, name: string) => (name === 'then' ? undefined : model(name)) });

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.close();
  if (tempMusicDir) fs.rmSync(tempMusicDir, { recursive: true, force: true });
});
const tokens = ROLES.map((role, i) => jwt.sign({ id: i + 1, username: role, role }, config.jwtSecret, { algorithm: 'HS256' }));

/** Fills the path parameters: the server connection under test, virtual server 1, '3' for any other id. */
function concrete(p: string, configId: number): string {
  return p.replace(/:configId/g, String(configId)).replace(/\*\w+/g, 'x').replace(/:\w+/g, (n) => (n === ':sid' ? '1' : '3'));
}
async function call(method: string, url: string, token: string): Promise<string> {
  const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
  await res.arrayBuffer();
  return res.status === REACHED ? 'ok' : String(res.status);
}

async function buildMatrix(): Promise<Record<string, Record<string, string>>> {
  const matrix: Record<string, Record<string, string>> = {};
  for (const r of routes) {
    // Unauthenticated public routes are not this test's business.
    if (!r.path.startsWith('/api/') || /^\/api\/(setup|public-config|widget|file-downloads|backup-downloads|auth)(\/|$)/.test(r.path)) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < ROLES.length; i++) {
      row[ROLES[i]] = await call(r.method, concrete(r.path, GRANTED_CONFIG), tokens[i]);
      if (r.path.includes(':configId')) row[`${ROLES[i]} (no grant)`] = await call(r.method, concrete(r.path, FOREIGN_CONFIG), tokens[i]);
    }
    matrix[`${r.method} ${r.path}`] = row;
  }
  return matrix;
}

const matrix = await buildMatrix();

test('the access matrix equals the reviewed snapshot', () => {
  if (process.env.ACCESS_MATRIX_UPDATE === '1') {
    fs.writeFileSync(SNAPSHOT, JSON.stringify(matrix, null, 2) + '\n');
    return;
  }
  const expected = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const diffs: string[] = [];
  for (const key of new Set([...Object.keys(expected), ...Object.keys(matrix)])) {
    if (!(key in expected)) diffs.push(`new route ${key}: ${JSON.stringify(matrix[key])}`);
    else if (!(key in matrix)) diffs.push(`route gone ${key}`);
    else if (JSON.stringify(expected[key]) !== JSON.stringify(matrix[key])) diffs.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(matrix[key])}`);
  }
  assert.equal(diffs.length, 0, `Access matrix changed (rerun with ACCESS_MATRIX_UPDATE=1 if intended):\n${diffs.join('\n')}`);
});

test('the matrix found the routes it is meant to guard', () => {
  assert.ok(Object.keys(matrix).length > 150, `only ${Object.keys(matrix).length} routes found - did the router layout change?`);
  assert.equal(matrix['POST /api/servers/:configId/vs/:sid/clients/:clid/kick']?.admin, 'ok');
});

// Independent of the snapshot: areas no permission can open, whatever the role templates say.
const ADMIN_ONLY = [
  /^\/api\/servers\/:configId\/(console|instance)(\/|$)/,
  /^\/api\/servers\/:configId\/vs\/:sid\/(logs|statistics)(\/|$)/,
  /^\/api\/servers\/:configId\/virtual-servers(\/:sid)?(\/(start|stop|snapshot|snapshot\/deploy|permission-reset))?$/,
  /^\/api\/servers\/:configId\/vs\/:sid\/permissions\/automatic-groups\//,
  /^\/api\/servers\/:configId\/(identity|global-message|test|bot-identity)$/,
  /^\/api\/(users|widgets|backups|change-log|connection-journal)(\/|$)/,
  /^\/api\/settings\/(?!webgui-theme$|webgui-base-theme$|webgui-design$)/,
];
const isAdminOnly = (method: string, p: string) =>
  ADMIN_ONLY.some((re) => re.test(p))
  && !(method === 'GET' && p === '/api/servers/:configId/virtual-servers') // the list (server.view)
  && !(method === 'PUT' && p === '/api/servers/:configId/virtual-servers/:sid'); // settings (vserver.edit)

test('no non-admin role reaches an admin-only area', () => {
  const leaks = Object.entries(matrix).flatMap(([key, row]) => {
    const [method, p] = key.split(' ');
    if (!isAdminOnly(method, p) && !(method !== 'GET' && /^\/api\/servers(\/:configId)?$/.test(p))) return [];
    return Object.entries(row).filter(([who, status]) => !who.startsWith('admin') && status === 'ok').map(([who]) => `${key} as ${who}`);
  });
  assert.deepEqual(leaks, []);
  assert.ok(isAdminOnly('POST', '/api/servers/:configId/console/execute'), 'the admin-only patterns no longer match the console');
});

test('no non-admin role reaches a route on virtual server 0 (the instance) or a malformed sid', async () => {
  const leaks: string[] = [];
  for (const r of routes.filter((x) => x.path.includes('/vs/:sid'))) {
    for (const sid of ['0', '00', '1a', '-1']) {
      const url = concrete(r.path, GRANTED_CONFIG).replace('/vs/1/', `/vs/${sid}/`).replace(/\/vs\/1$/, `/vs/${sid}`);
      for (let i = 1; i < ROLES.length; i++) {
        if (await call(r.method, url, tokens[i]) === 'ok') leaks.push(`${r.method} ${url} as ${ROLES[i]}`);
      }
    }
  }
  assert.deepEqual(leaks, []);
});

test('no route answers a non-admin on a server connection without a grant', () => {
  const leaks = Object.entries(matrix).flatMap(([key, row]) =>
    Object.entries(row).filter(([who, status]) => who.endsWith('(no grant)') && !who.startsWith('admin') && status === 'ok').map(([who]) => `${key} as ${who}`));
  assert.deepEqual(leaks, []);
});
