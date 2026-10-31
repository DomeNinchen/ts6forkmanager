import { Server, Lock, Palette, Users, UserCog, Film, Video, Globe, Bug, Timer, ShieldCheck, RefreshCw, type LucideIcon } from 'lucide-react';

export interface SettingsTab {
  /** The `?tab=` value in the address. */
  value: string;
  labelKey: string;
  icon: LucideIcon;
  adminOnly: boolean;
}

/**
 * The Settings page's tabs, in order. Cockpit shows them as tabs on the page; Lounge shows
 * them as the second navigation row, like the pages of every other section.
 */
const SETTINGS_TABS: SettingsTab[] = [
  { value: 'connections', labelKey: 'pages.settings.tabs.connections', icon: Server, adminOnly: true },
  { value: 'account', labelKey: 'pages.settings.tabs.account', icon: Lock, adminOnly: false },
  { value: 'webgui', labelKey: 'pages.settings.tabs.webgui', icon: Palette, adminOnly: false },
  { value: 'users', labelKey: 'pages.settings.tabs.users', icon: Users, adminOnly: true },
  { value: 'roles', labelKey: 'pages.settings.tabs.roles', icon: UserCog, adminOnly: true },
  { value: 'youtube', labelKey: 'pages.settings.tabs.youtube', icon: Film, adminOnly: true },
  { value: 'streaming', labelKey: 'pages.settings.tabs.streaming', icon: Video, adminOnly: true },
  { value: 'network', labelKey: 'pages.settings.tabs.network', icon: Globe, adminOnly: true },
  { value: 'debug', labelKey: 'pages.settings.tabs.debug', icon: Bug, adminOnly: true },
  { value: 'restart', labelKey: 'pages.settings.tabs.restart', icon: Timer, adminOnly: true },
  { value: 'sso', labelKey: 'pages.settings.tabs.sso', icon: ShieldCheck, adminOnly: true },
  { value: 'update-status', labelKey: 'pages.settings.tabs.updateStatus', icon: RefreshCw, adminOnly: true },
];

export const DEFAULT_SETTINGS_TAB = 'account';

export function settingsTabsFor(isAdmin: boolean): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => isAdmin || !tab.adminOnly);
}

/** The tab named in the address if this user can open it, else the default. */
export function resolveSettingsTab(requested: string | null, isAdmin: boolean): string {
  return settingsTabsFor(isAdmin).some((tab) => tab.value === requested) ? requested! : DEFAULT_SETTINGS_TAB;
}
