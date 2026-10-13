import type { ComponentType } from 'react';
import { DashboardUserHistoryCard } from '@/components/statistics/DashboardUserHistoryCard';
import { OnlineUsersTile, ChannelsTile, UptimeTile, PingTile } from './StatTiles';
import { BandwidthTile } from './BandwidthTile';
import { CapacityTile } from './CapacityTile';
import { BotFlowsTile } from './BotFlowsTile';
import type { TileProps } from './tile-types';

/** The dashboard's building blocks, by their stable id. */
export const DASHBOARD_TILES: Record<string, ComponentType<TileProps>> = {
  onlineUsers: OnlineUsersTile,
  channels: ChannelsTile,
  uptime: UptimeTile,
  ping: PingTile,
  userHistory: DashboardUserHistoryCard,
  bandwidth: BandwidthTile,
  capacity: CapacityTile,
  botFlows: BotFlowsTile,
};

/** How wide a tile is on a wide screen: 1 = a third of the row, 2 = two thirds, 3 = the whole row. Below the `lg` breakpoint every tile takes the full width. */
export type TileWidth = 1 | 2 | 3;

// Spelled out so Tailwind sees the full class names.
export const TILE_WIDTH_CLASS: Record<TileWidth, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
};

export interface TileLayoutEntry {
  id: string;
  width: TileWidth;
}

/** The layout everyone starts with. */
export const DEFAULT_LAYOUT: TileLayoutEntry[] = [
  { id: 'onlineUsers', width: 1 },
  { id: 'channels', width: 1 },
  { id: 'uptime', width: 1 },
  { id: 'ping', width: 3 },
  { id: 'userHistory', width: 3 },
  { id: 'bandwidth', width: 2 },
  { id: 'capacity', width: 1 },
  { id: 'botFlows', width: 3 },
];
