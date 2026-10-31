// bot-operator: viewer + full control of Bot Flows and Music Bots (and their
// library/playlists/radio stations) on their assigned servers.
// music-operator: viewer + the same, but Music Bots only, no Bot Flows.
// server-admin: everything on their assigned servers that is not instance- or app-wide, except Bot Flows.
// moderator: viewer + poke/message, move, kick and ban clients, read the ban list, handle complaints.
// That is each role's default (ROLE_PERMISSIONS in ../permissions.ts); the admin can change it in Settings > Roles.
export type UserRole = 'admin' | 'server-admin' | 'moderator' | 'viewer' | 'bot-operator' | 'music-operator';

/** A role the admin defined (permissions.ts: CustomRoleKey). */
export type CustomRoleKey = `custom:${number}`;

export interface JwtPayload {
  id: number;
  username: string;
  role: UserRole | CustomRoleKey;
  iat?: number;
  exp?: number;
}
