import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The columns of the Client Database list that can be switched on and off. */
export const CLIENT_DB_COLUMN_IDS = [
  'status', 'nickname', 'cldbid', 'uid', 'created', 'lastConnected', 'totalConnections', 'lastIp', 'description', 'loginName',
] as const;
export type ClientDbColumnId = (typeof CLIENT_DB_COLUMN_IDS)[number];

export const DEFAULT_VISIBLE_COLUMNS: ClientDbColumnId[] = [
  'status', 'nickname', 'cldbid', 'uid', 'lastConnected', 'totalConnections', 'lastIp', 'description',
];

/** Without its nickname a row is hard to tell apart, so this column stays. */
export const REQUIRED_COLUMN: ClientDbColumnId = 'nickname';

interface ClientDatabaseViewStore {
  visibleColumns: ClientDbColumnId[];
  /**
   * Server groups left out of group mode, per server ("configId:sid"). Remembering what is hidden rather
   * than what is shown means a group created later appears by itself.
   */
  hiddenGroups: Record<string, number[]>;
  setColumnVisible: (id: ClientDbColumnId, visible: boolean) => void;
  resetColumns: () => void;
  setHiddenGroups: (serverKey: string, sgids: number[]) => void;
}

/** The column picker and the group picker of the Client Database page, remembered per browser. */
export const useClientDatabaseViewStore = create<ClientDatabaseViewStore>()(
  persist(
    (set, get) => ({
      visibleColumns: DEFAULT_VISIBLE_COLUMNS,
      hiddenGroups: {},
      setColumnVisible: (id, visible) => {
        if (id === REQUIRED_COLUMN) return;
        const current = get().visibleColumns;
        // Keep the catalogue's order, whatever order the boxes were ticked in.
        const next = CLIENT_DB_COLUMN_IDS.filter((c) => (c === id ? visible : current.includes(c)));
        set({ visibleColumns: next });
      },
      resetColumns: () => set({ visibleColumns: DEFAULT_VISIBLE_COLUMNS }),
      setHiddenGroups: (serverKey, sgids) => set({ hiddenGroups: { ...get().hiddenGroups, [serverKey]: sgids } }),
    }),
    { name: 'ts6-client-database', version: 1 },
  ),
);
