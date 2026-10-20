import { create } from 'zustand';

/** Whether the backend answers its health check (open to everyone, banned addresses included). */
export async function backendAnswers(): Promise<boolean> {
  try {
    return (await fetch('/api/health', { cache: 'no-store' })).ok;
  } catch {
    return false;
  }
}

interface RestartStore {
  /** The backend did not answer: shown as RestartNotice until it does again. */
  down: boolean;
  /** A request got no answer or a proxy's 502/503/504 - only a failed health check makes that `down`. */
  suspect: () => void;
}

let checking = false;

export const useRestartStore = create<RestartStore>((set, get) => ({
  down: false,
  suspect: () => {
    if (get().down || checking) return;
    checking = true;
    void backendAnswers()
      .then((ok) => { if (!ok) set({ down: true }); })
      .finally(() => { checking = false; });
  },
}));
