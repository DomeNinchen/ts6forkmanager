import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { assertClientsNotProtected, assertProfilesNotProtected, targetIds, PROTECTED_TARGET } from './protected-groups.js';
import { AppError } from '../middleware/error-handler.js';

// The TeamSpeak side and the database are stand-ins here; the live check against a real server is in the PR.
const CLIENTS = [
  { clid: 5, client_nickname: 'Anna', client_servergroups: '8' },
  { clid: 6, client_nickname: 'Max', client_servergroups: '6,8' }, // 6 = protected below
  { clid: 7, client_nickname: 'Query', client_servergroups: '' },
];
const PROFILE_GROUPS: Record<string, { sgid: string }[]> = { '100': [{ sgid: '8' }], '101': [{ sgid: '8' }, { sgid: '6' }] };

function setup(role: string, protectedSgids: number[]) {
  const calls: string[] = [];
  const prisma = { protectedServerGroup: { findMany: async () => protectedSgids.map((sgid) => ({ sgid })) } };
  const req = { user: { role }, params: { configId: '1', sid: '1' }, app: { locals: { prisma } } } as unknown as Request;
  const client = {
    execute: async (_sid: number, cmd: string, params: Record<string, string>) => {
      calls.push(cmd);
      if (cmd === 'clientlist') return CLIENTS;
      if (cmd === 'servergroupsbyclientid') return PROFILE_GROUPS[params.cldbid] ?? [];
      throw new Error(`unexpected ${cmd}`);
    },
  } as any;
  return { req, client, calls };
}

async function refusal(p: Promise<void>): Promise<AppError | null> {
  try { await p; return null; } catch (err) { return err as AppError; }
}

test('a non-admin is refused for a client in a protected group, named in details', async () => {
  const { req, client } = setup('moderator', [6]);
  const err = await refusal(assertClientsNotProtected(req, client, [5, 6]));
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, PROTECTED_TARGET);
  assert.equal(err.details, 'Max');
});

test('clients outside protected groups, and clids the server does not know, pass', async () => {
  const { req, client } = setup('moderator', [6]);
  assert.equal(await refusal(assertClientsNotProtected(req, client, [5, 7, 99])), null);
});

test('an admin is never checked, and nothing protected means no query at all', async () => {
  const admin = setup('admin', [6]);
  assert.equal(await refusal(assertClientsNotProtected(admin.req, admin.client, [6])), null);
  assert.deepEqual(admin.calls, []);
  const none = setup('server-admin', []);
  assert.equal(await refusal(assertClientsNotProtected(none.req, none.client, [6])), null);
  assert.deepEqual(none.calls, []);
});

test('the server admin is held to the protection as well', async () => {
  const { req, client } = setup('server-admin', [8]);
  const err = await refusal(assertClientsNotProtected(req, client, [5]));
  assert.equal(err?.code, PROTECTED_TARGET);
});

test('a failing group lookup refuses the action (fails closed)', async () => {
  const { req } = setup('moderator', [6]);
  const broken = { execute: async () => { throw new Error('connection lost'); } } as any;
  assert.ok(await refusal(assertClientsNotProtected(req, broken, [5])));
});

test('offline profiles are checked by their groups', async () => {
  const { req, client } = setup('server-admin', [6]);
  const err = await refusal(assertProfilesNotProtected(req, client, [100, 101]));
  assert.equal(err?.code, PROTECTED_TARGET);
  assert.equal(err?.details, '#101');
  assert.equal(await refusal(assertProfilesNotProtected(req, client, [100])), null);
});

test('target ids must be plain positive numbers, so one request cannot name targets the check never saw', () => {
  assert.deepEqual(targetIds([5, '6'], 'clids'), [5, 6]);
  for (const bad of [['5|6'], ['5,6'], ['abc'], [0], [-1], [1.5], ['']]) {
    assert.throws(() => targetIds(bad, 'clids'), (e: unknown) => e instanceof AppError && e.statusCode === 400, JSON.stringify(bad));
  }
  assert.throws(() => targetIds([], 'clids'));
});
