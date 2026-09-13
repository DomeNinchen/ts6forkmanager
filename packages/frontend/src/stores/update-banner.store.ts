import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UpdateComponent = 'backend' | 'sidecar' | 'frontend';

interface UpdateBannerStore {
  /** The `latest` version string the admin last dismissed the banner for, per component - so postponing v1.25.0 stays postponed forever unless v1.26.0 shows up, rather than nagging again for the same version. */
  dismissedFor: Record<UpdateComponent, string | null>;
  dismiss: (component: UpdateComponent, version: string) => void;
}

export const useUpdateBannerStore = create<UpdateBannerStore>()(
  persist(
    (set, get) => ({
      dismissedFor: { backend: null, sidecar: null, frontend: null },
      dismiss: (component, version) =>
        set({ dismissedFor: { ...get().dismissedFor, [component]: version } }),
    }),
    { name: 'ts6-update-banner' },
  ),
);
