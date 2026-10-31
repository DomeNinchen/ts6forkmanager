import type { CustomRoleKey, UserRole } from './types/auth.js';

/**
 * The actions a non-admin role can be allowed, one name per kind of request. Every TeamSpeak action
 * runs through the server connection's own (highly privileged) query login, so TeamSpeak cannot tell
 * the web users apart: this list and the roles built from it are the only thing that limits them.
 *
 * Each route a non-admin may reach names exactly one of these at its mount in the backend's app.ts.
 * Anything not named there stays admin-only: the console, the instance, creating/starting/stopping/
 * deleting virtual servers, the server log (client IP addresses), the statistics page, the server
 * connections and their API keys, users, app settings, backups, the change log, the connection
 * journal and the embed widgets.
 */
export const USER_PERMISSIONS = [
  'server.view',        // dashboard, channel/client lists, icons, the virtual server list, the flow list
  'groups.view',        // the server group list
  'clients.message',    // poke and message a client
  'clients.move',
  'clients.kick',
  'clients.ban',
  'clients.manage',     // client details (incl. IP address), their groups, set descriptions
  'clients.database',   // the client database: list, search, details, ban, delete
  'bans.view',
  'bans.manage',        // add ban rules, delete bans
  'complaints.manage',
  'channels.edit',      // create, edit, move channels
  'channels.delete',
  'groups.members',     // server group members, channel group assignments
  'groups.edit',        // create, rename, copy, delete server and channel groups
  'permissions.edit',   // every permission view and change (groups, channels, clients)
  'tokens.manage',      // privilege keys and temporary passwords
  'files.manage',       // the file browser
  'icons.manage',
  'messages.manage',    // offline messages of the query login
  'vserver.edit',       // virtual server settings, server-wide message, log entries
  'music.manage',       // music bots, library, playlists, radio stations, chat-command permissions
  'bots.manage',        // bot flows
] as const;

export type UserPermission = (typeof USER_PERMISSIONS)[number];

/**
 * Permissions that let a user raise their own or someone else's power on the TeamSpeak server
 * (group membership and rights, privilege keys, files, flows that can run any query command).
 */
export const ESCALATING_PERMISSIONS: readonly UserPermission[] = [
  'groups.members', 'groups.edit', 'permissions.edit', 'tokens.manage', 'files.manage', 'bots.manage',
];

/** Every role, in the order the user management shows them. */
export const USER_ROLES: readonly UserRole[] = ['admin', 'server-admin', 'moderator', 'bot-operator', 'music-operator', 'viewer'];

/** The fixed roles whose permissions the admin may change (every one but the admin's). */
export const EDITABLE_ROLES: readonly UserRole[] = USER_ROLES.filter((r) => r !== 'admin');

/**
 * A role the admin defined, stored on the user as "custom:<id>". It may hold any permission except
 * ESCALATING_PERMISSIONS.
 */
export function customRoleKey(id: number): CustomRoleKey {
  return `custom:${id}`;
}

/** The id of a custom role key, or undefined for anything else. */
export function customRoleId(role: string | undefined): number | undefined {
  const m = role?.match(/^custom:([1-9]\d{0,9})$/);
  return m ? Number(m[1]) : undefined;
}

/** What each role may do, by role key. */
export type RoleTable = Readonly<Record<string, readonly UserPermission[]>>;

/** What each fixed role may do by default. The admin may do everything, including what no permission names. */
export const ROLE_PERMISSIONS: Record<UserRole, readonly UserPermission[]> = {
  admin: USER_PERMISSIONS,
  'server-admin': USER_PERMISSIONS.filter((p) => p !== 'bots.manage'),
  moderator: [
    'server.view', 'groups.view', 'clients.message', 'clients.move', 'clients.kick', 'clients.ban',
    'bans.view', 'complaints.manage',
  ],
  'bot-operator': ['server.view', 'groups.view', 'music.manage', 'bots.manage'],
  'music-operator': ['server.view', 'groups.view', 'music.manage'],
  viewer: ['server.view'],
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Whether the role may do this, looked up in `table` (the backend passes the roles as the admin
 * set them up). The admin may do everything; an unknown role (or none) may do nothing.
 */
export function roleHasPermission(role: string | undefined, permission: UserPermission, table: RoleTable = ROLE_PERMISSIONS): boolean {
  if (role === 'admin') return true;
  return role !== undefined && Object.prototype.hasOwnProperty.call(table, role) && table[role].includes(permission);
}
