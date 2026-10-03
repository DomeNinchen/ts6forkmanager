import type { ClientDbColumnId } from '@/stores/client-database.store';

/** The translation key (under pages.clientDatabase.columns) of each column's header. */
export const COLUMN_LABEL_KEYS: Record<ClientDbColumnId, string> = {
  status: 'status',
  nickname: 'nickname',
  cldbid: 'dbId',
  uid: 'uid',
  created: 'created',
  lastConnected: 'lastSeen',
  totalConnections: 'connections',
  lastIp: 'lastIp',
  description: 'description',
  loginName: 'loginName',
};
