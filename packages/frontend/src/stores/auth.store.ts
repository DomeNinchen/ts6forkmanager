import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { roleHasPermission, type UserPermission, type UserRole } from '@ts6/common';

interface UserInfo {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  authProvider?: 'local' | 'oidc';
  totpEnabled?: boolean;
  language?: string | null;
}

interface AuthStore {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserInfo | null;
  setAuth: (accessToken: string, refreshToken: string, user: UserInfo) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  updateUser: (patch: Partial<UserInfo>) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
  isAdmin: () => boolean;
  canWrite: () => boolean;
  /**
   * Whether the user's role holds this permission (the admin holds every one). Only decides what
   * the UI offers - the backend checks every request itself.
   */
  can: (permission: UserPermission) => boolean;
  /** bots.manage - full Bot Flow access on their assigned servers */
  canManageBotFlows: () => boolean;
  /** music.manage - Music Bot access on their assigned servers */
  canManageMusicBots: () => boolean;
}

// M9: Tokens stored in localStorage. This is an accepted tradeoff — no XSS vectors
// exist in the frontend (no dangerouslySetInnerHTML, no eval). If XSS is introduced,
// consider moving to httpOnly cookies or in-memory storage.
export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setAuth: (accessToken, refreshToken, user) =>
        set({ accessToken, refreshToken, user }),
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),
      updateUser: (patch) =>
        set((s) => ({ user: s.user ? { ...s.user, ...patch } : s.user })),
      logout: () =>
        set({ accessToken: null, refreshToken: null, user: null }),
      isAuthenticated: () => !!get().accessToken,
      isAdmin: () => get().user?.role === 'admin',
      canWrite: () => get().user?.role === 'admin',
      can: (permission) => roleHasPermission(get().user?.role, permission),
      canManageBotFlows: () => get().can('bots.manage'),
      canManageMusicBots: () => get().can('music.manage'),
    }),
    { name: 'ts6-auth' },
  ),
);
