import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { UserRole } from '@ts6/common';
import { adminExcept, EVERY_ROLE, MUSIC_ROLES, BOT_FLOW_ROLES, type OpenRoute } from './access-policy.js';

/**
 * Runs the adminExcept(open) gate for one request and reports what it did:
 * 'next' when it let the request through, or the HTTP status it answered with.
 * The whole role separation of the app rests on this gate, so its path/method/
 * role matching is worth pinning down with a test.
 */
function run(open: readonly OpenRoute[], role: UserRole | undefined, method: string, path: string): 'next' | number {
  const req = { user: role ? { role } : undefined, method, path } as unknown as Request;
  let status: number | undefined;
  const res = {
    status(code: number) { status = code; return this; },
    json() { return this; },
  } as unknown as Response;
  let nexted = false;
  adminExcept(open)(req, res, () => { nexted = true; });
  return nexted ? 'next' : status!;
}

test('an unauthenticated request is refused with 401', () => {
  assert.equal(run([], undefined, 'GET', '/'), 401);
});

test('admin passes even a mount with no open routes', () => {
  assert.equal(run([], 'admin', 'DELETE', '/anything'), 'next');
});

test('a non-admin is refused by default (403) when nothing is opened', () => {
  for (const role of ['viewer', 'bot-operator', 'music-operator'] as UserRole[]) {
    assert.equal(run([], role, 'GET', '/'), 403);
  }
});

test('an open GET "/" lets the listed roles read it but not write it', () => {
  const open: OpenRoute[] = [{ method: 'GET', path: '/', roles: EVERY_ROLE }];
  assert.equal(run(open, 'viewer', 'GET', '/'), 'next');
  assert.equal(run(open, 'viewer', 'HEAD', '/'), 'next');   // HEAD counts as GET
  assert.equal(run(open, 'viewer', 'POST', '/'), 403);      // method not opened
  assert.equal(run(open, 'viewer', 'GET', '/other'), 403);  // path not opened
});

test('roles are honoured per open route', () => {
  const open: OpenRoute[] = [{ method: 'GET', path: '/', roles: MUSIC_ROLES }];
  assert.equal(run(open, 'music-operator', 'GET', '/'), 'next'); // in MUSIC_ROLES
  assert.equal(run(open, 'viewer', 'GET', '/'), 403);            // not in MUSIC_ROLES
});

test('a ":id" segment matches exactly one path segment', () => {
  const open: OpenRoute[] = [{ method: 'GET', path: '/:botId', roles: BOT_FLOW_ROLES }];
  assert.equal(run(open, 'bot-operator', 'GET', '/42'), 'next');
  assert.equal(run(open, 'bot-operator', 'GET', '/42/executions'), 403); // deeper path not matched
});

test('a trailing "/*" opens everything below that prefix', () => {
  const open: OpenRoute[] = [{ method: '*', path: '/*', roles: MUSIC_ROLES }];
  assert.equal(run(open, 'music-operator', 'POST', '/a/b/c'), 'next');
  assert.equal(run(open, 'viewer', 'POST', '/a/b/c'), 403); // role still enforced
});

test('matching is case-sensitive, so a differently cased path fails closed', () => {
  const open: OpenRoute[] = [{ method: 'GET', path: '/tokens', roles: EVERY_ROLE }];
  assert.equal(run(open, 'viewer', 'GET', '/tokens'), 'next');
  assert.equal(run(open, 'viewer', 'GET', '/Tokens'), 403);
});

test('a trailing slash on the request path is normalised to the open path', () => {
  const open: OpenRoute[] = [{ method: 'GET', path: '/usage', roles: EVERY_ROLE }];
  assert.equal(run(open, 'viewer', 'GET', '/usage/'), 'next');
});
