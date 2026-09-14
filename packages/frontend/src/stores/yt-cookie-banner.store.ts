import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface YtCookieBannerStore {
  /** The `checkedAt` timestamp of the invalid finding the admin last dismissed - so postponing today's finding stays postponed until a *later* check reconfirms it's still invalid, rather than nagging on every page load. */
  dismissedFor: string | null;
  dismiss: (checkedAt: string) => void;
}

export const useYtCookieBannerStore = create<YtCookieBannerStore>()(
  persist(
    (set) => ({
      dismissedFor: null,
      dismiss: (checkedAt) => set({ dismissedFor: checkedAt }),
    }),
    { name: 'ts6-yt-cookie-banner' },
  ),
);
