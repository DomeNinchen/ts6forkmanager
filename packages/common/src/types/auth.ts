// bot-operator: viewer + full control of Bot Flows and Music Bots (and their
// library/playlists/radio stations) on their assigned servers.
// music-operator: viewer + the same, but Music Bots only, no Bot Flows.
export type UserRole = 'admin' | 'viewer' | 'bot-operator' | 'music-operator';

export interface JwtPayload {
  id: number;
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
