import type { ComponentType } from 'react';
import { parseUserSetting, type DashboardTileSetting, type DashboardTileWidth } from '@ts6/common';
import { DashboardUserHistoryCard } from '@/components/statistics/DashboardUserHistoryCard';
import { OnlineUsersTile, ChannelsTile, UptimeTile, PingTile } from './StatTiles';
import { BandwidthTile } from './BandwidthTile';
import { CapacityTile } from './CapacityTile';
import { BotFlowsTile } from './BotFlowsTile';
import type { TileProps } from './tile-types';

interface TileDef {
  component: ComponentType<TileProps>;
  /** i18n key of the tile's name in the customise mode. */
  labelKey: string;
  /** i18n key of a note shown under the name in the customise mode. */
  hintKey?: string;
}

/** The dashboard's building blocks, by their stable id - the id is what a user's stored layout refers to. */
const DASHBOARD_TILES: Record<string, TileDef> = {
  onlineUsers: { component: OnlineUsersTile, labelKey: 'pages.dashboard.onlineUsers' },
  channels: { component: ChannelsTile, labelKey: 'pages.dashboard.channels' },
  uptime: { component: UptimeTile, labelKey: 'pages.dashboard.uptime' },
  ping: { component: PingTile, labelKey: 'pages.dashboard.ping' },
  userHistory: { component: DashboardUserHistoryCard, labelKey: 'pages.dashboard.userHistory.title' },
  bandwidth: { component: BandwidthTile, labelKey: 'pages.dashboard.bandwidth' },
  capacity: { component: CapacityTile, labelKey: 'pages.dashboard.serverCapacity' },
  botFlows: { component: BotFlowsTile, labelKey: 'pages.dashboard.botFlows', hintKey: 'pages.dashboard.tiles.botFlowsHint' },
};

/** Own keys only: a stored id like "constructor" must not resolve to something on Object.prototype. */
export function tileDef(id: string): TileDef | undefined {
  return Object.prototype.hasOwnProperty.call(DASHBOARD_TILES, id) ? DASHBOARD_TILES[id] : undefined;
}

// Spelled out so Tailwind sees the full class names. Below `lg` every tile takes the full width.
export const TILE_WIDTH_CLASS: Record<DashboardTileWidth, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
};

/** The layout everyone starts with, and what "Reset" goes back to. */
export const DEFAULT_LAYOUT: DashboardTileSetting[] = [
  { id: 'onlineUsers', width: 1 },
  { id: 'channels', width: 1 },
  { id: 'uptime', width: 1 },
  { id: 'ping', width: 3 },
  { id: 'userHistory', width: 3 },
  { id: 'bandwidth', width: 2 },
  { id: 'capacity', width: 1 },
  { id: 'botFlows', width: 3 },
];

/**
 * The layout to show for a stored value: its tiles in its order with ids this version does not
 * know dropped, then every tile it does not mention (one added in a later version) at the end,
 * visible and at its default width. Anything unusable gives the default layout.
 */
export function resolveLayout(stored: unknown): DashboardTileSetting[] {
  const parsed = parseUserSetting('dashboardLayout', stored);
  if (!parsed) return DEFAULT_LAYOUT;
  const tiles = parsed.tiles.filter((t) => tileDef(t.id));
  const listed = new Set(tiles.map((t) => t.id));
  return [...tiles, ...DEFAULT_LAYOUT.filter((t) => !listed.has(t.id))];
}

/** Whether a layout is the default one - saving it then removes the stored layout instead, so the user keeps following the default. */
export function isDefaultLayout(layout: DashboardTileSetting[]): boolean {
  const plain = (l: DashboardTileSetting[]) => JSON.stringify(l.map((t) => [t.id, t.width, !!t.hidden]));
  return plain(layout) === plain(DEFAULT_LAYOUT);
}
