import type { TempGroupNoticeSettings, TemporaryGroupEntry } from '@ts6/common';
import api from './client';

const sgBase = (configId: number, sid: number) =>
  `/servers/${configId}/vs/${sid}/server-groups`;
const tgBase = (configId: number, sid: number) =>
  `/servers/${configId}/vs/${sid}/temporary-groups`;

/** A deadline as the backend takes it: a duration from now, or a point in time (ISO 8601). */
export type TempGroupDeadline = { durationMs: number } | { expiresAt: string };
const cgBase = (configId: number, sid: number) =>
  `/servers/${configId}/vs/${sid}/channel-groups`;

export const groupsApi = {
  // Server groups
  serverGroups: (configId: number, sid: number) =>
    api.get(sgBase(configId, sid)).then((r) => r.data),
  createServerGroup: (configId: number, sid: number, name: string) =>
    api.post(sgBase(configId, sid), { name }).then((r) => r.data),
  /** `skipBackup`: go on after the backup before it failed (R9). */
  deleteServerGroup: (configId: number, sid: number, sgid: number, skipBackup = false) =>
    api.delete(`${sgBase(configId, sid)}/${sgid}`, skipBackup ? { data: { skipBackup } } : undefined),
  renameServerGroup: (configId: number, sid: number, sgid: number, name: string) =>
    api.put(`${sgBase(configId, sid)}/${sgid}`, { name }).then((r) => r.data),
  serverGroupMembers: (configId: number, sid: number, sgid: number) =>
    api.get(`${sgBase(configId, sid)}/${sgid}/members`).then((r) => r.data),
  addServerGroupMember: (configId: number, sid: number, sgid: number, cldbid: number) =>
    api.post(`${sgBase(configId, sid)}/${sgid}/members`, { cldbid }).then((r) => r.data),
  removeServerGroupMember: (configId: number, sid: number, sgid: number, cldbid: number) =>
    api.delete(`${sgBase(configId, sid)}/${sgid}/members/${cldbid}`),
  protectedServerGroups: (configId: number, sid: number) =>
    api.get(`${sgBase(configId, sid)}/protected`).then((r) => r.data.sgids as number[]),
  setServerGroupProtected: (configId: number, sid: number, sgid: number, isProtected: boolean) =>
    api.put(`${sgBase(configId, sid)}/${sgid}/protected`, { protected: isProtected }).then((r) => r.data),
  serverGroupPerms: (configId: number, sid: number, sgid: number) =>
    api.get(`${sgBase(configId, sid)}/${sgid}/permissions`).then((r) => r.data),

  // Temporary server group memberships (R13)
  temporaryGroups: (configId: number, sid: number, scope: 'open' | 'history') =>
    api.get(tgBase(configId, sid), { params: scope === 'history' ? { scope } : undefined }).then((r) => r.data as TemporaryGroupEntry[]),
  grantTemporaryGroup: (configId: number, sid: number, body: { sgid: number; cldbid: number; setDeadline?: boolean } & TempGroupDeadline) =>
    api.post(tgBase(configId, sid), body).then((r) => r.data as TemporaryGroupEntry),
  updateTemporaryGroup: (configId: number, sid: number, id: number, body: { extendByMs: number } | TempGroupDeadline) =>
    api.put(`${tgBase(configId, sid)}/${id}`, body).then((r) => r.data as TemporaryGroupEntry),
  makeTemporaryGroupPermanent: (configId: number, sid: number, id: number) =>
    api.post(`${tgBase(configId, sid)}/${id}/permanent`).then((r) => r.data as TemporaryGroupEntry),
  revokeTemporaryGroup: (configId: number, sid: number, id: number) =>
    api.post(`${tgBase(configId, sid)}/${id}/revoke`).then((r) => r.data as TemporaryGroupEntry),
  temporaryGroupNoticeSettings: (configId: number, sid: number) =>
    api.get(`${tgBase(configId, sid)}/notice-settings`).then((r) => r.data as { settings: TempGroupNoticeSettings; defaults: TempGroupNoticeSettings }),
  setTemporaryGroupNoticeSettings: (configId: number, sid: number, settings: TempGroupNoticeSettings) =>
    api.put(`${tgBase(configId, sid)}/notice-settings`, settings).then((r) => r.data as { settings: TempGroupNoticeSettings }),

  // Channel groups
  channelGroups: (configId: number, sid: number) =>
    api.get(cgBase(configId, sid)).then((r) => r.data),
  createChannelGroup: (configId: number, sid: number, name: string) =>
    api.post(cgBase(configId, sid), { name }).then((r) => r.data),
  deleteChannelGroup: (configId: number, sid: number, cgid: number, skipBackup = false) =>
    api.delete(`${cgBase(configId, sid)}/${cgid}`, skipBackup ? { data: { skipBackup } } : undefined),
  channelGroupPerms: (configId: number, sid: number, cgid: number) =>
    api.get(`${cgBase(configId, sid)}/${cgid}/permissions`).then((r) => r.data),
  channelGroupsByClient: (configId: number, sid: number, cldbid: number) =>
    api.get(`${cgBase(configId, sid)}/by-client/${cldbid}`).then((r) => r.data),
  assignChannelGroup: (configId: number, sid: number, cgid: number, cid: number, cldbid: number) =>
    api.post(`${cgBase(configId, sid)}/${cgid}/assign`, { cid, cldbid }).then((r) => r.data),
};
