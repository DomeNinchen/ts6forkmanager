// bot-operator: viewer + full control of Bot Flows and Music Bots (and their
// library/playlists/radio stations) on their assigned servers.
// music-operator: viewer + the same, but Music Bots only, no Bot Flows.
// server-admin: everything on their assigned servers that is not instance- or app-wide, except Bot Flows.
// moderator: viewer + poke/message, move, kick and ban clients, read bans and the server log, handle complaints.
// What each role may do exactly is ROLE_PERMISSIONS in ../permissions.ts.
export type UserRole = 'admin' | 'server-admin' | 'moderator' | 'viewer' | 'bot-operator' | 'music-operator';

export interface JwtPayload {
  id: number;
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
