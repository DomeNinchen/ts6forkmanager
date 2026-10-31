import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS, USER_PERMISSIONS } from '@ts6/common';
import { isAssignableRole, loadRoleTable, mayRole, parseStoredPermissions, permissionsOf } from './role-table.js';

/** A prisma stand-in holding just the two role tables. */
function fakePrisma(overrides: { role: string; permissions: string }[], customs: { id: number; name: string; permissions: string }[]) {
  return {
    rolePermissionOverride: { findMany: async () => overrides },
    customRole: { findMany: async () => customs },
  } as any;
}

test('before any change the fixed roles hold their defaults', async () => {
  await loadRoleTable(fakePrisma([], []));
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) assert.deepEqual(permissionsOf(role), perms);
  assert.equal(mayRole('viewer', 'clients.kick'), false);
  assert.equal(mayRole('admin', 'bots.manage'), true);
});

test('a changed fixed role may get any permission, escalating ones included', async () => {
  await loadRoleTable(fakePrisma([{ role: 'moderator', permissions: JSON.stringify(['server.view', 'permissions.edit']) }], []));
  assert.equal(mayRole('moderator', 'permissions.edit'), true);
  assert.equal(mayRole('moderator', 'clients.kick'), false);
  // the rest keeps its defaults
  assert.deepEqual(permissionsOf('server-admin'), ROLE_PERMISSIONS['server-admin']);
});

test('an override for the admin role is ignored', async () => {
  await loadRoleTable(fakePrisma([{ role: 'admin', permissions: '[]' }], []));
  assert.deepEqual(permissionsOf('admin'), USER_PERMISSIONS);
  assert.equal(mayRole('admin', 'clients.kick'), true);
});

test('a custom role never holds an escalating permission, even if stored', async () => {
  await loadRoleTable(fakePrisma([], [{ id: 3, name: 'Support', permissions: JSON.stringify(['server.view', 'clients.kick', 'bots.manage', 'groups.members']) }]));
  assert.deepEqual(permissionsOf('custom:3'), ['server.view', 'clients.kick']);
  assert.equal(mayRole('custom:3', 'bots.manage'), false);
  assert.equal(isAssignableRole('custom:3'), true);
});

test('unknown and deleted roles may do nothing and cannot be given', async () => {
  await loadRoleTable(fakePrisma([], [{ id: 3, name: 'Support', permissions: '["server.view"]' }]));
  for (const role of ['custom:4', 'custom:03', 'custom:', 'constructor', '__proto__', 'toString', 'Admin', '']) {
    assert.equal(mayRole(role, 'server.view'), false, role);
    assert.equal(isAssignableRole(role), false, role);
  }
  await loadRoleTable(fakePrisma([], []));
  assert.equal(mayRole('custom:3', 'server.view'), false);
});

test('a broken stored list grants nothing', () => {
  assert.deepEqual(parseStoredPermissions('not json', false), []);
  assert.deepEqual(parseStoredPermissions('{"a":1}', false), []);
  assert.deepEqual(parseStoredPermissions('["server.view","made.up"]', false), ['server.view']);
});
