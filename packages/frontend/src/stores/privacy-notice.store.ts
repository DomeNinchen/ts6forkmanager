import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PrivacyNoticeStore {
  /** Whether this browser's visitor already clicked the storage notice away. Only ever remembered in this browser, never sent anywhere. */
  dismissed: boolean;
  dismiss: () => void;
}

export const usePrivacyNoticeStore = create<PrivacyNoticeStore>()(
  persist(
    (set) => ({
      dismissed: false,
      dismiss: () => set({ dismissed: true }),
    }),
    { name: 'ts6-privacy-notice' },
  ),
);
