import { create } from 'zustand';
import type { BulkOutcome } from '@ts6/common';

/** The result of the last bulk action that did not fully go through, shown by BulkResultDialog in the layout. */
interface BulkResultStore {
  title: string;
  outcomes: BulkOutcome[] | null;
  show: (title: string, outcomes: BulkOutcome[]) => void;
  close: () => void;
}

export const useBulkResultStore = create<BulkResultStore>((set) => ({
  title: '',
  outcomes: null,
  show: (title, outcomes) => set({ title, outcomes }),
  close: () => set({ outcomes: null }),
}));
