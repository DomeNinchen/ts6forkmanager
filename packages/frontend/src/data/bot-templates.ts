import { Clock, Users, Shield, Globe, Zap, MessageSquare, Moon, Timer, Megaphone, Award, FolderPlus, Eye, Webhook, Sparkles } from 'lucide-react';
import type { TFunction } from 'i18next';

export interface TemplateConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  placeholder?: string;
  defaultValue?: string;
  options?: { label: string; value: string }[];
  required?: boolean;
  /** Visual nesting depth (16px per level) - purely cosmetic, to show which fields belong together. */
  indent?: number;
  /** Field is only shown (and only enforced if required) when every one of these matches the current config. */
  conditions?: { field: string; value: string }[];
}

export interface BotTemplate {
  id: string;
  name: string;
  description: string;
  category: 'info-channels' | 'moderation' | 'automation' | 'integration';
  icon: React.ElementType;
  configFields: TemplateConfigField[];
  flowDataFactory: (config: Record<string, string>) => { nodes: any[]; edges: any[] };
  /** Placeholders this template's message field(s) resolve automatically - shown to the user while customizing. */
  variablesHint?: string[];
}

let _id = 0;
let _eid = 0;
const nid = () => `tpl_${++_id}`;
// Own counter, independent of nid() - a node with two outgoing edges (e.g. an
// out/error pair) calls this twice in a row with no nid() call in between, so
// piggybacking on _id (as this used to) handed out the same id to both edges.
const eid = () => `tpl_e${++_eid}`;

function resetIds() { _id = 0; _eid = 0; }

// Helper to build a simple linear flow
function makeNode(id: string, type: string, label: string, config: Record<string, any>, x: number, y: number) {
  return { id, type, label, config, x, y };
}
function makeEdge(id: string, source: string, target: string, sourcePort = 'out', targetPort = 'in') {
  return { id, source, sourcePort, target, targetPort };
}

const DEFAULT_WELCOME_MESSAGE = 'Welcome {{event.client_nickname}}!\nOnline: {{temp.onlineCount}} | Team online: {{temp.teamOnline}}\nThis is your {{temp.dbInfo.0.client_totalconnections}}. visit.';

// Names, descriptions and config field labels below are the only translated
// parts of a template - node labels and config values inside flowDataFactory
// become the actual bot flow the admin can freely rename/edit afterward, and
// message/channel-name defaults are TeamSpeak-facing bot output (same class
// as music-command-handler's replies), so both stay English like those do.
export function getBotTemplates(t: TFunction): BotTemplate[] { return [
  // ===== INFO CHANNELS =====
  {
    id: 'clock-channel',
    name: t('data.botTemplates.items.clockChannel.name'),
    description: t('data.botTemplates.items.clockChannel.description'),
    category: 'info-channels',
    icon: Clock,
    configFields: [
      { key: 'channelId', label: t('data.botTemplates.items.clockChannel.fields.channelId.label'), type: 'number', placeholder: '42', required: true },
      { key: 'timezone', label: t('data.botTemplates.items.clockChannel.fields.timezone.label'), type: 'select', defaultValue: 'Europe/Berlin', options: [
        { label: 'Europe/Berlin (CET/CEST)', value: 'Europe/Berlin' },
        { label: 'Europe/London (GMT/BST)', value: 'Europe/London' },
        { label: 'Europe/Paris (CET/CEST)', value: 'Europe/Paris' },
        { label: 'Europe/Moscow (MSK)', value: 'Europe/Moscow' },
        { label: 'America/New_York (EST/EDT)', value: 'America/New_York' },
        { label: 'America/Chicago (CST/CDT)', value: 'America/Chicago' },
        { label: 'America/Los_Angeles (PST/PDT)', value: 'America/Los_Angeles' },
        { label: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
        { label: 'UTC', value: 'UTC' },
      ] },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_cron', 'Every Minute', { cron: '* * * * *', timezone: cfg.timezone || 'Europe/Berlin' }, 60, 80),
          makeNode(n2, 'action_channelEdit', 'Update Clock', { channelId: cfg.channelId, channel_name: '[cspacer]{{time.time}}' }, 300, 80),
        ],
        edges: [makeEdge(eid(), n1, n2)],
      };
    },
  },
  {
    id: 'online-counter',
    name: t('data.botTemplates.items.onlineCounter.name'),
    description: t('data.botTemplates.items.onlineCounter.description'),
    category: 'info-channels',
    icon: Users,
    configFields: [
      { key: 'channelId', label: t('data.botTemplates.items.onlineCounter.fields.channelId.label'), type: 'number', placeholder: '43', required: true },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_cron', 'Every Minute', { cron: '* * * * *' }, 60, 80),
          makeNode(n2, 'action_webquery', 'Get Server Info', { command: 'serverinfo', storeAs: 'server' }, 300, 80),
          makeNode(n3, 'action_channelEdit', 'Update Counter', { channelId: cfg.channelId, channel_name: '[cspacer]Online: {{temp.server.0.virtualserver_clientsonline}}/{{temp.server.0.virtualserver_maxclients}}' }, 540, 80),
        ],
        edges: [makeEdge(eid(), n1, n2), makeEdge(eid(), n2, n3)],
      };
    },
  },
  {
    id: 'server-stats',
    name: t('data.botTemplates.items.serverStats.name'),
    description: t('data.botTemplates.items.serverStats.description'),
    category: 'info-channels',
    icon: Eye,
    configFields: [
      { key: 'uptimeChannelId', label: t('data.botTemplates.items.serverStats.fields.uptimeChannelId.label'), type: 'number', placeholder: '44', required: true },
      { key: 'clientsChannelId', label: t('data.botTemplates.items.serverStats.fields.clientsChannelId.label'), type: 'number', placeholder: '45', required: true },
      { key: 'channelCountChannelId', label: t('data.botTemplates.items.serverStats.fields.channelCountChannelId.label'), type: 'number', placeholder: '46', required: true },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid(), n4 = nid(), n5 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_cron', 'Every 5 Min', { cron: '*/5 * * * *' }, 60, 150),
          makeNode(n2, 'action_webquery', 'Get Server Info', { command: 'serverinfo', storeAs: 'server' }, 300, 150),
          makeNode(n3, 'action_channelEdit', 'Uptime', { channelId: cfg.uptimeChannelId, channel_name: '[cspacer]Uptime: {{temp.server.0.virtualserver_uptime|uptime}}' }, 540, 60),
          makeNode(n4, 'action_channelEdit', 'Clients', { channelId: cfg.clientsChannelId, channel_name: '[cspacer]Clients: {{temp.server.0.virtualserver_clientsonline}}/{{temp.server.0.virtualserver_maxclients}}' }, 540, 150),
          makeNode(n5, 'action_channelEdit', 'Channels', { channelId: cfg.channelCountChannelId, channel_name: '[cspacer]Channels: {{temp.server.0.virtualserver_channelsonline}}' }, 540, 240),
        ],
        edges: [
          makeEdge(eid(), n1, n2),
          makeEdge(eid(), n2, n3),
          makeEdge(eid(), n2, n4),
          makeEdge(eid(), n2, n5),
        ],
      };
    },
  },

  {
    id: 'animated-channel',
    name: t('data.botTemplates.items.animatedChannel.name'),
    description: t('data.botTemplates.items.animatedChannel.description'),
    category: 'info-channels',
    icon: Sparkles,
    configFields: [
      { key: 'channelId', label: t('data.botTemplates.items.animatedChannel.fields.channelId.label'), type: 'number', placeholder: '42', required: true },
      { key: 'text', label: t('data.botTemplates.items.animatedChannel.fields.text.label'), type: 'text', placeholder: 'Welcome to MyServer', required: true },
      { key: 'style', label: t('data.botTemplates.items.animatedChannel.fields.style.label'), type: 'select', defaultValue: 'scroll', options: [
        { label: t('data.botTemplates.items.animatedChannel.fields.style.options.0'), value: 'scroll' },
        { label: t('data.botTemplates.items.animatedChannel.fields.style.options.1'), value: 'typewriter' },
        { label: t('data.botTemplates.items.animatedChannel.fields.style.options.2'), value: 'bounce' },
        { label: t('data.botTemplates.items.animatedChannel.fields.style.options.3'), value: 'blink' },
        { label: t('data.botTemplates.items.animatedChannel.fields.style.options.4'), value: 'wave' },
        { label: t('data.botTemplates.items.animatedChannel.fields.style.options.5'), value: 'alternateCase' },
      ] },
      { key: 'intervalSeconds', label: t('data.botTemplates.items.animatedChannel.fields.intervalSeconds.label'), type: 'select', defaultValue: '3', options: [
        { label: t('data.botTemplates.items.animatedChannel.fields.intervalSeconds.options.0'), value: '5' },
        { label: t('data.botTemplates.items.animatedChannel.fields.intervalSeconds.options.1'), value: '3' },
        { label: t('data.botTemplates.items.animatedChannel.fields.intervalSeconds.options.2'), value: '2' },
        { label: t('data.botTemplates.items.animatedChannel.fields.intervalSeconds.options.3'), value: '1' },
        { label: t('data.botTemplates.items.animatedChannel.fields.intervalSeconds.options.4'), value: '0.5' },
        { label: t('data.botTemplates.items.animatedChannel.fields.intervalSeconds.options.5'), value: '0.25' },
      ] },
      { key: 'prefix', label: t('data.botTemplates.items.animatedChannel.fields.prefix.label'), type: 'text', placeholder: '[cspacer]', defaultValue: '[cspacer]' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid();
      return {
        nodes: [
          makeNode(n1, 'action_animatedChannel', 'Animated Channel', {
            channelId: cfg.channelId,
            text: cfg.text || 'Welcome to MyServer',
            style: cfg.style || 'scroll',
            intervalSeconds: cfg.intervalSeconds || '3',
            prefix: cfg.prefix || '[cspacer]',
          }, 200, 100),
        ],
        edges: [],
      };
    },
  },

  // ===== AUTOMATION =====
  {
    id: 'welcome-message',
    name: t('data.botTemplates.items.welcomeMessage.name'),
    description: t('data.botTemplates.items.welcomeMessage.description'),
    category: 'automation',
    icon: MessageSquare,
    variablesHint: t('data.botTemplates.items.welcomeMessage.variablesHint', { returnObjects: true }) as string[],
    configFields: [
      { key: 'message', label: t('data.botTemplates.items.welcomeMessage.fields.message.label'), type: 'textarea', placeholder: DEFAULT_WELCOME_MESSAGE },
      { key: 'usePokeInstead', label: t('data.botTemplates.items.welcomeMessage.fields.usePokeInstead.label'), type: 'select', defaultValue: 'message', options: [{ label: t('data.botTemplates.items.welcomeMessage.fields.usePokeInstead.options.0'), value: 'message' }, { label: t('data.botTemplates.items.welcomeMessage.fields.usePokeInstead.options.1'), value: 'poke' }] },
      { key: 'ignoreGroupIds', label: t('data.botTemplates.items.welcomeMessage.fields.ignoreGroupIds.label'), type: 'text', placeholder: 'e.g. Music Bot / Team server group IDs - these clients never get a welcome message' },
      { key: 'teamGroupIds', label: t('data.botTemplates.items.welcomeMessage.fields.teamGroupIds.label'), type: 'text', placeholder: 'e.g. 6,7' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const usePoke = cfg.usePokeInstead === 'poke';
      const ignoreGroupIds = (cfg.ignoreGroupIds || '').split(',').map((s) => s.trim()).filter(Boolean);
      const teamGroupIds = (cfg.teamGroupIds || '').trim();
      const message = cfg.message || DEFAULT_WELCOME_MESSAGE;

      const nodes: any[] = [];
      const edges: any[] = [];
      let lastId: string;

      // --- Main chain: client joins. Deliberately linear (no node has more than one
      // incoming edge) - this engine walks edges depth-first with no "wait for all
      // branches" join, so a node reachable via two paths would run twice. ---
      const nTrigger = nid();
      nodes.push(makeNode(nTrigger, 'trigger_event', 'Client Enter', { eventName: 'notifycliententerview' }, 40, 200));
      const nHuman = nid();
      nodes.push(makeNode(nHuman, 'condition', 'Is Human?', { expression: 'event.client_type == 0' }, 280, 200));
      edges.push(makeEdge(eid(), nTrigger, nHuman));
      lastId = nHuman;

      if (ignoreGroupIds.length > 0) {
        const expr = ignoreGroupIds.map((g) => `hasGroup(event.client_servergroups,'${g}') == 0`).join(' and ');
        const nIgnoreGroups = nid();
        nodes.push(makeNode(nIgnoreGroups, 'condition', 'Not Ignored Group?', { expression: expr }, 520, 200));
        edges.push(makeEdge(eid(), lastId, nIgnoreGroups, 'true', 'in'));
        lastId = nIgnoreGroups;
      }

      const nNotOptedOut = nid();
      nodes.push(makeNode(nNotOptedOut, 'condition', 'Not Opted Out?', { expression: "contains(var.wmpIgnoredClients, event.client_unique_identifier) == 0" }, 760, 200));
      edges.push(makeEdge(eid(), lastId, nNotOptedOut, 'true', 'in'));
      lastId = nNotOptedOut;

      // Real users only - virtualserver_clientsonline (from serverinfo) counts
      // ServerQuery connections too (this bot's own identity, the admin WebUI's
      // own connection, SSH), inflating the number a joining user is shown.
      const nOnlineCount = nid();
      nodes.push(makeNode(nOnlineCount, 'action_countOnlineInGroups', 'Get Online Count', { groupIds: '', storeAs: 'onlineCount' }, 1000, 200));
      edges.push(makeEdge(eid(), lastId, nOnlineCount, 'true', 'in'));
      lastId = nOnlineCount;

      const nDbInfo = nid();
      nodes.push(makeNode(nDbInfo, 'action_webquery', 'Get Total Connections', { command: 'clientdbinfo', params: { cldbid: '{{event.client_database_id}}' }, storeAs: 'dbInfo' }, 1240, 200));
      edges.push(makeEdge(eid(), lastId, nDbInfo));
      lastId = nDbInfo;

      if (teamGroupIds) {
        const nTeamCount = nid();
        nodes.push(makeNode(nTeamCount, 'action_countOnlineInGroups', 'Count Team Online', { groupIds: teamGroupIds, storeAs: 'teamOnline' }, 1480, 200));
        edges.push(makeEdge(eid(), lastId, nTeamCount));
        lastId = nTeamCount;
      }

      const nSend = nid();
      nodes.push(
        usePoke
          ? makeNode(nSend, 'action_poke', 'Welcome Poke', { message }, 1720, 200)
          : makeNode(nSend, 'action_message', 'Welcome Msg', { targetMode: 'client', message }, 1720, 200)
      );
      edges.push(makeEdge(eid(), lastId, nSend));

      // --- Opt-out chain: !wmp ignore / !wmp unignore ---
      const y = 420;
      const nCmdTrigger = nid();
      nodes.push(makeNode(nCmdTrigger, 'trigger_command', '!wmp', { command: '!wmp' }, 40, y));
      const nSenderInfo = nid();
      nodes.push(makeNode(nSenderInfo, 'action_webquery', 'Get Sender UID', { command: 'clientinfo', params: { clid: '{{event.clid}}' }, storeAs: 'senderInfo' }, 280, y));
      edges.push(makeEdge(eid(), nCmdTrigger, nSenderInfo));

      const nIsIgnoreCmd = nid();
      nodes.push(makeNode(nIsIgnoreCmd, 'condition', 'Is "ignore"?', { expression: "event.command_args == 'ignore'" }, 520, y - 60));
      edges.push(makeEdge(eid(), nSenderInfo, nIsIgnoreCmd));
      const nAddIgnore = nid();
      nodes.push(makeNode(nAddIgnore, 'action_listMembership', 'Add to Ignore List', { listName: 'wmpIgnoredClients', operation: 'add', value: '{{temp.senderInfo.0.client_unique_identifier}}' }, 760, y - 60));
      edges.push(makeEdge(eid(), nIsIgnoreCmd, nAddIgnore, 'true', 'in'));
      const nConfirmIgnore = nid();
      nodes.push(makeNode(nConfirmIgnore, 'action_message', 'Confirm Ignore', { targetMode: 'client', message: "You won't receive welcome messages anymore. Use !wmp unignore to re-enable them." }, 1000, y - 60));
      edges.push(makeEdge(eid(), nAddIgnore, nConfirmIgnore));

      const nIsUnignoreCmd = nid();
      nodes.push(makeNode(nIsUnignoreCmd, 'condition', 'Is "unignore"?', { expression: "event.command_args == 'unignore'" }, 520, y + 60));
      edges.push(makeEdge(eid(), nSenderInfo, nIsUnignoreCmd));
      const nRemoveIgnore = nid();
      nodes.push(makeNode(nRemoveIgnore, 'action_listMembership', 'Remove from Ignore List', { listName: 'wmpIgnoredClients', operation: 'remove', value: '{{temp.senderInfo.0.client_unique_identifier}}' }, 760, y + 60));
      edges.push(makeEdge(eid(), nIsUnignoreCmd, nRemoveIgnore, 'true', 'in'));
      const nConfirmUnignore = nid();
      nodes.push(makeNode(nConfirmUnignore, 'action_message', 'Confirm Unignore', { targetMode: 'client', message: "You'll receive welcome messages again." }, 1000, y + 60));
      edges.push(makeEdge(eid(), nRemoveIgnore, nConfirmUnignore));

      return { nodes, edges };
    },
  },
  {
    // Rebuilt from the ground up, inspired by (and adapted for this app's own
    // engine from) the SinusBot script "Support Channel notifier + channel
    // creator" (v1.4) by Mortis and Andreas Fink
    // (https://github.com/mortisdotpro/support-channel-mover, MIT) - credit to
    // the original authors whose idea this template's behaviour is based on.
    id: 'support-system',
    name: t('data.botTemplates.items.supportSystem.name'),
    description: t('data.botTemplates.items.supportSystem.description'),
    category: 'automation',
    icon: Megaphone,
    variablesHint: t('data.botTemplates.items.supportSystem.variablesHint', { returnObjects: true }) as string[],
    configFields: [
      { key: 'supportChannelId', label: t('data.botTemplates.items.supportSystem.fields.supportChannelId.label'), type: 'number', placeholder: '15', required: true },
      { key: 'parentChannelId', label: t('data.botTemplates.items.supportSystem.fields.parentChannelId.label'), type: 'number', placeholder: 'e.g. 19' },
      { key: 'supporterGroupIds', label: t('data.botTemplates.items.supportSystem.fields.supporterGroupIds.label'), type: 'text', placeholder: '6,7', required: true },
      { key: 'afkChannelId', label: t('data.botTemplates.items.supportSystem.fields.afkChannelId.label'), type: 'number', placeholder: 'e.g. 12' },
      { key: 'roomName', label: t('data.botTemplates.items.supportSystem.fields.roomName.label'), type: 'text', defaultValue: 'Support » {{temp.client.0.client_nickname}}' },
      { key: 'roomType', label: t('data.botTemplates.items.supportSystem.fields.roomType.label'), type: 'select', defaultValue: 'temporary', options: [
        { label: t('data.botTemplates.items.supportSystem.fields.roomType.options.0'), value: 'temporary' },
        { label: t('data.botTemplates.items.supportSystem.fields.roomType.options.1'), value: 'semipermanent' },
        { label: t('data.botTemplates.items.supportSystem.fields.roomType.options.2'), value: 'permanent' },
      ] },
      { key: 'notifyMethod', label: t('data.botTemplates.items.supportSystem.fields.notifyMethod.label'), type: 'select', defaultValue: 'poke', options: [
        { label: t('data.botTemplates.items.supportSystem.fields.notifyMethod.options.0'), value: 'poke' },
        { label: t('data.botTemplates.items.supportSystem.fields.notifyMethod.options.1'), value: 'chat' },
      ] },
      { key: 'userMessage', label: t('data.botTemplates.items.supportSystem.fields.userMessage.label'), type: 'text', defaultValue: 'A supporter has been notified.' },
      { key: 'supporterMessage', label: t('data.botTemplates.items.supportSystem.fields.supporterMessage.label'), type: 'text', defaultValue: 'A user needs help in the support channel.' },
      { key: 'offlineMessage', label: t('data.botTemplates.items.supportSystem.fields.offlineMessage.label'), type: 'text', defaultValue: 'No supporter is available right now, please try again later.' },
      { key: 'listMode', label: t('data.botTemplates.items.supportSystem.fields.listMode.label'), type: 'select', defaultValue: 'none', options: [
        { label: t('data.botTemplates.items.supportSystem.fields.listMode.options.0'), value: 'none' },
        { label: t('data.botTemplates.items.supportSystem.fields.listMode.options.1'), value: 'whitelist' },
        { label: t('data.botTemplates.items.supportSystem.fields.listMode.options.2'), value: 'blacklist' },
      ] },
      { key: 'listGroupIds', label: t('data.botTemplates.items.supportSystem.fields.listGroupIdsWhitelist.label'), type: 'text', placeholder: '8', required: true, indent: 1, conditions: [{ field: 'listMode', value: 'whitelist' }] },
      { key: 'listGroupIds', label: t('data.botTemplates.items.supportSystem.fields.listGroupIdsBlacklist.label'), type: 'text', placeholder: '9', required: true, indent: 1, conditions: [{ field: 'listMode', value: 'blacklist' }] },
      { key: 'blockedMessage', label: t('data.botTemplates.items.supportSystem.fields.blockedMessage.label'), type: 'text', defaultValue: 'You are not allowed to use the support channel.', indent: 1, conditions: [{ field: 'listMode', value: 'whitelist' }] },
      { key: 'blockedMessage', label: t('data.botTemplates.items.supportSystem.fields.blockedMessage.label'), type: 'text', defaultValue: 'You are not allowed to use the support channel.', indent: 1, conditions: [{ field: 'listMode', value: 'blacklist' }] },
      { key: 'waitingRoomToggle', label: t('data.botTemplates.items.supportSystem.fields.waitingRoomToggle.label'), type: 'select', defaultValue: 'no', options: [
        { label: t('data.botTemplates.items.supportSystem.fields.waitingRoomToggle.options.0'), value: 'no' },
        { label: t('data.botTemplates.items.supportSystem.fields.waitingRoomToggle.options.1'), value: 'yes' },
      ] },
      { key: 'waitingRoomOpenName', label: t('data.botTemplates.items.supportSystem.fields.waitingRoomOpenName.label'), type: 'text', defaultValue: 'Support — OPEN', indent: 1, conditions: [{ field: 'waitingRoomToggle', value: 'yes' }] },
      { key: 'waitingRoomClosedName', label: t('data.botTemplates.items.supportSystem.fields.waitingRoomClosedName.label'), type: 'text', defaultValue: 'Support — CLOSED', indent: 1, conditions: [{ field: 'waitingRoomToggle', value: 'yes' }] },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const nodes: any[] = [];
      const edges: any[] = [];
      const notifyType = cfg.notifyMethod === 'chat' ? 'action_message' : 'action_poke';
      const supporterGroups = String(cfg.supporterGroupIds || '').split(',').map((s) => s.trim()).filter(Boolean);
      const listGroups = String(cfg.listGroupIds || '').split(',').map((s) => s.trim()).filter(Boolean);
      // Count real supporters online, parked-in-AFK ones excluded, shared by both branches.
      const countParams = { groupIds: cfg.supporterGroupIds || '', excludeChannelIds: cfg.afkChannelId || '', storeAs: 'supporters' };

      // A message to the user (the client who just joined), via the chosen method.
      const notifyUser = (id: string, label: string, message: string, x: number, y: number) =>
        nodes.push(makeNode(id, notifyType, label, { message }, x, y));

      // Layout as a branched tree: the happy path runs along one horizontal spine (SPINE_Y),
      // every node in its own column (COL apart), and each dead-end offshoot (refused / no
      // supporter / creation failed) sits one column further and one clear row away - above
      // for the upper port (true), below for the lower one (false/error) - so no line has to
      // cross another or loop back around its own node. The waiting-room timer below uses
      // the same grid.
      const COL = 240;
      const SPINE_Y = 240;
      const offshootY = (port: string) => (port === 'true' ? SPINE_Y - 160 : SPINE_Y + 160);

      // ===== Branch 1: a client joins the support channel =====
      let x = 40;
      const nTrigger = nid();
      nodes.push(makeNode(nTrigger, 'trigger_event', 'Client Joins Support', { eventName: 'notifyclientmoved' }, x, SPINE_Y));
      x += COL;
      const nJoined = nid();
      nodes.push(makeNode(nJoined, 'condition', 'Joined Support?', { expression: `event.ctid == ${cfg.supportChannelId || 0}` }, x, SPINE_Y));
      edges.push(makeEdge(eid(), nTrigger, nJoined));
      x += COL;
      // notifyclientmoved carries clid/ctid but not nickname/groups/db-id - one clientinfo
      // lookup fills temp.client for the name placeholders, the list check and the move.
      const nInfo = nid();
      nodes.push(makeNode(nInfo, 'action_webquery', 'Get Client Info', { command: 'clientinfo', params: { clid: '{{event.clid}}' }, storeAs: 'client' }, x, SPINE_Y));
      edges.push(makeEdge(eid(), nJoined, nInfo, 'true', 'in'));
      x += COL;

      let last = nInfo;
      let lastPort: string | undefined = undefined;

      // White-/blacklist by server group (group IDs known now, folded into one expression).
      if ((cfg.listMode === 'whitelist' || cfg.listMode === 'blacklist') && listGroups.length) {
        const inList = listGroups.map((g) => `hasGroup(temp.client.0.client_servergroups, '${g}')`).join(' || ');
        const listX = x;
        const nList = nid();
        const label = cfg.listMode === 'whitelist' ? 'Allowed In?' : 'On Blacklist?';
        nodes.push(makeNode(nList, 'condition', label, { expression: inList }, listX, SPINE_Y));
        edges.push(makeEdge(eid(), last, nList, lastPort, 'in'));
        // The port that means "refused": false for a whitelist, true for a blacklist.
        const refusedPort = cfg.listMode === 'whitelist' ? 'false' : 'true';
        const allowedPort = cfg.listMode === 'whitelist' ? 'true' : 'false';
        if (cfg.blockedMessage) {
          const nBlocked = nid();
          notifyUser(nBlocked, 'Tell Blocked User', cfg.blockedMessage, listX + COL, offshootY(refusedPort));
          edges.push(makeEdge(eid(), nList, nBlocked, refusedPort, 'in'));
        }
        last = nList;
        lastPort = allowedPort;
        x += COL;
      }

      // Supporters online?
      const nCount = nid();
      nodes.push(makeNode(nCount, 'action_countOnlineInGroups', 'Count Supporters Online', countParams, x, SPINE_Y));
      edges.push(makeEdge(eid(), last, nCount, lastPort, 'in'));
      x += COL;
      const onlineX = x;
      const nOnline = nid();
      nodes.push(makeNode(nOnline, 'condition', 'Supporter Available?', { expression: 'temp.supporters > 0' }, onlineX, SPINE_Y));
      edges.push(makeEdge(eid(), nCount, nOnline));
      x += COL;

      // No supporter online -> tell the user, stop.
      if (cfg.offlineMessage) {
        const nOffline = nid();
        notifyUser(nOffline, 'No Supporter Online', cfg.offlineMessage, onlineX + COL, offshootY('false'));
        edges.push(makeEdge(eid(), nOnline, nOffline, 'false', 'in'));
      }

      // Supporter online -> notify user, notify supporters, create the room, move the user in.
      last = nOnline;
      lastPort = 'true';
      if (cfg.userMessage) {
        const nUser = nid();
        notifyUser(nUser, 'Reassure User', cfg.userMessage, x, SPINE_Y);
        edges.push(makeEdge(eid(), last, nUser, lastPort, 'in'));
        last = nUser;
        lastPort = undefined;
        x += COL;
      }
      if (cfg.supporterMessage) {
        for (const g of supporterGroups) {
          const nPoke = nid();
          nodes.push(makeNode(nPoke, 'action_pokeGroup', `Notify Supporters (${g})`, { groupId: g, message: cfg.supporterMessage }, x, SPINE_Y));
          edges.push(makeEdge(eid(), last, nPoke, lastPort, 'in'));
          last = nPoke;
          lastPort = undefined;
          x += COL;
        }
      }

      const channelParams: Record<string, string> = {
        channel_name: cfg.roomName || 'Support » {{temp.client.0.client_nickname}}',
        channel_codec: '4',
        channel_codec_quality: '6',
        channel_flag_maxclients_unlimited: '1',
        channel_codec_is_unencrypted: '1',
      };
      if (cfg.parentChannelId) channelParams.cpid = cfg.parentChannelId;
      if (cfg.roomType === 'permanent') channelParams.channel_flag_permanent = '1';
      else if (cfg.roomType === 'semipermanent') channelParams.channel_flag_semi_permanent = '1';
      else { channelParams.channel_flag_temporary = '1'; channelParams.channel_delete_delay = '0'; }

      const createX = x;
      const nCreate = nid();
      nodes.push(makeNode(nCreate, 'action_channelCreate', 'Create Support Room', { params: channelParams }, createX, SPINE_Y));
      edges.push(makeEdge(eid(), last, nCreate, lastPort, 'in'));
      x += COL;
      // If the room can't be created (e.g. a bad parent channel), tell the user instead of
      // failing silently.
      const nCreateErr = nid();
      notifyUser(nCreateErr, 'Creation Failed', 'Your support room could not be created, please contact an admin.', createX + COL, offshootY('error'));
      edges.push(makeEdge(eid(), nCreate, nCreateErr, 'error', 'in'));
      const nMove = nid();
      nodes.push(makeNode(nMove, 'action_move', 'Move User Into Room', { channelId: '{{temp.lastCreatedChannelId}}' }, x, SPINE_Y));
      edges.push(makeEdge(eid(), nCreate, nMove));

      // ===== Branch 2: keep the waiting room OPEN/CLOSED by supporter availability =====
      // Runs on a timer (not only when someone joins) - otherwise a closed room nobody can
      // enter would never re-open. A stored state avoids renaming the channel every minute.
      if (cfg.waitingRoomToggle === 'yes') {
        const wrVar = 'supportWaitingRoomState';
        const CRON_Y = 820; // its own spine, well below branch 1 and its lower offshoots
        const OPEN_Y = CRON_Y - 160; // true  -> open, one row up
        const CLOSED_Y = CRON_Y + 160; // false -> closed, one row down
        let cx = 40;
        const nCron = nid();
        nodes.push(makeNode(nCron, 'trigger_cron', 'Every Minute', { cron: '* * * * *' }, cx, CRON_Y));
        cx += COL;
        const nCronCount = nid();
        nodes.push(makeNode(nCronCount, 'action_countOnlineInGroups', 'Count Supporters Online', countParams, cx, CRON_Y));
        edges.push(makeEdge(eid(), nCron, nCronCount));
        cx += COL;
        const nCronOnline = nid();
        nodes.push(makeNode(nCronOnline, 'condition', 'Supporter Available?', { expression: 'temp.supporters > 0' }, cx, CRON_Y));
        edges.push(makeEdge(eid(), nCronCount, nCronOnline));
        const splitX = cx + COL; // both sub-branches start one column after the split

        // Open branch (supporters online -> room stays/becomes OPEN)
        let ox = splitX;
        const nReadOpen = nid();
        nodes.push(makeNode(nReadOpen, 'variable', 'Read State', { operation: 'get', name: wrVar, storeAs: 'wrState' }, ox, OPEN_Y));
        edges.push(makeEdge(eid(), nCronOnline, nReadOpen, 'true', 'in'));
        ox += COL;
        const nNeedOpen = nid();
        nodes.push(makeNode(nNeedOpen, 'condition', 'Not Open Yet?', { expression: 'temp.wrState != "open"' }, ox, OPEN_Y));
        edges.push(makeEdge(eid(), nReadOpen, nNeedOpen));
        ox += COL;
        const nOpen = nid();
        nodes.push(makeNode(nOpen, 'action_channelEdit', 'Open Waiting Room', { channelId: String(cfg.supportChannelId || 0), params: { channel_name: cfg.waitingRoomOpenName || 'Support — OPEN', channel_flag_maxclients_unlimited: '1' } }, ox, OPEN_Y));
        edges.push(makeEdge(eid(), nNeedOpen, nOpen, 'true', 'in'));
        ox += COL;
        const nMarkOpen = nid();
        nodes.push(makeNode(nMarkOpen, 'variable', 'Mark Open', { operation: 'set', name: wrVar, value: 'open' }, ox, OPEN_Y));
        edges.push(makeEdge(eid(), nOpen, nMarkOpen));

        // Closed branch (no supporter -> room becomes CLOSED)
        let clx = splitX;
        const nReadClosed = nid();
        nodes.push(makeNode(nReadClosed, 'variable', 'Read State', { operation: 'get', name: wrVar, storeAs: 'wrState' }, clx, CLOSED_Y));
        edges.push(makeEdge(eid(), nCronOnline, nReadClosed, 'false', 'in'));
        clx += COL;
        const nNeedClosed = nid();
        nodes.push(makeNode(nNeedClosed, 'condition', 'Not Closed Yet?', { expression: 'temp.wrState != "closed"' }, clx, CLOSED_Y));
        edges.push(makeEdge(eid(), nReadClosed, nNeedClosed));
        clx += COL;
        const nClosed = nid();
        nodes.push(makeNode(nClosed, 'action_channelEdit', 'Close Waiting Room', { channelId: String(cfg.supportChannelId || 0), params: { channel_name: cfg.waitingRoomClosedName || 'Support — CLOSED', channel_maxclients: '0', channel_flag_maxclients_unlimited: '0' } }, clx, CLOSED_Y));
        edges.push(makeEdge(eid(), nNeedClosed, nClosed, 'true', 'in'));
        clx += COL;
        const nMarkClosed = nid();
        nodes.push(makeNode(nMarkClosed, 'variable', 'Mark Closed', { operation: 'set', name: wrVar, value: 'closed' }, clx, CLOSED_Y));
        edges.push(makeEdge(eid(), nClosed, nMarkClosed));
      }

      return { nodes, edges };
    },
  },
  {
    // Rebuilt from the ground up, inspired by (and adapted for this app's own
    // engine from) the "Private Channel Manager" plugin for SinusBot by
    // Smorrebrod / Cedrik Paetz <cedrik.paetz@gmail.com> - credit to the
    // original design this template's shape and field set is based on.
    id: 'private-channel-creator',
    name: t('data.botTemplates.items.privateChannelCreator.name'),
    description: t('data.botTemplates.items.privateChannelCreator.description'),
    category: 'automation',
    icon: FolderPlus,
    variablesHint: t('data.botTemplates.items.privateChannelCreator.variablesHint', { returnObjects: true }) as string[],
    configFields: [
      { key: 'lobbyChannelId', label: t('data.botTemplates.items.privateChannelCreator.fields.lobbyChannelId.label'), type: 'number', placeholder: '20', required: true },
      { key: 'parentChannelId', label: t('data.botTemplates.items.privateChannelCreator.fields.parentChannelId.label'), type: 'number', placeholder: 'e.g. 19' },
      { key: 'channelPlacement', label: t('data.botTemplates.items.privateChannelCreator.fields.channelPlacement.label'), type: 'select', defaultValue: 'sibling', options: [{ label: t('data.botTemplates.items.privateChannelCreator.fields.channelPlacement.options.0'), value: 'sibling' }, { label: t('data.botTemplates.items.privateChannelCreator.fields.channelPlacement.options.1'), value: 'sub' }] },
      { key: 'channelAdminGroupId', label: t('data.botTemplates.items.privateChannelCreator.fields.channelAdminGroupId.label'), type: 'number', placeholder: '5', required: true },
      { key: 'channelNameTemplate', label: t('data.botTemplates.items.privateChannelCreator.fields.channelNameTemplate.label'), type: 'text', defaultValue: "{{temp.joinerInfo.0.client_nickname}}'s Private Channel" },
      { key: 'channelDescriptionTemplate', label: t('data.botTemplates.items.privateChannelCreator.fields.channelDescriptionTemplate.label'), type: 'textarea', placeholder: 'e.g. Private channel of {{temp.joinerInfo.0.client_nickname}}, created {{time.date}}' },
      { key: 'privateChannelType', label: t('data.botTemplates.items.privateChannelCreator.fields.privateChannelType.label'), type: 'select', defaultValue: 'semipermanent', options: [{ label: t('data.botTemplates.items.privateChannelCreator.fields.privateChannelType.options.0'), value: 'permanent' }, { label: t('data.botTemplates.items.privateChannelCreator.fields.privateChannelType.options.1'), value: 'semipermanent' }, { label: t('data.botTemplates.items.privateChannelCreator.fields.privateChannelType.options.2'), value: 'temporary' }] },
      { key: 'autoGeneratePassword', label: t('data.botTemplates.items.privateChannelCreator.fields.autoGeneratePassword.label'), type: 'select', defaultValue: 'no', options: [{ label: t('data.botTemplates.items.privateChannelCreator.fields.autoGeneratePassword.options.0'), value: 'no' }, { label: t('data.botTemplates.items.privateChannelCreator.fields.autoGeneratePassword.options.1'), value: 'yes' }] },
      { key: 'spamProtectionEnabled', label: t('data.botTemplates.items.privateChannelCreator.fields.spamProtectionEnabled.label'), type: 'select', defaultValue: 'no', options: [{ label: t('data.botTemplates.items.privateChannelCreator.fields.spamProtectionEnabled.options.0'), value: 'no' }, { label: t('data.botTemplates.items.privateChannelCreator.fields.spamProtectionEnabled.options.1'), value: 'yes' }] },
      { key: 'spamProtectionMaxStrikes', label: t('data.botTemplates.items.privateChannelCreator.fields.spamProtectionMaxStrikes.label'), type: 'number', defaultValue: '10', indent: 1, conditions: [{ field: 'spamProtectionEnabled', value: 'yes' }] },
      { key: 'spamProtectionBanSeconds', label: t('data.botTemplates.items.privateChannelCreator.fields.spamProtectionBanSeconds.label'), type: 'number', defaultValue: '600', indent: 1, conditions: [{ field: 'spamProtectionEnabled', value: 'yes' }] },
      { key: 'channelCreateMessage', label: t('data.botTemplates.items.privateChannelCreator.fields.channelCreateMessage.label'), type: 'text', defaultValue: 'Your private channel has been created!' },
      { key: 'channelMoveMessage', label: t('data.botTemplates.items.privateChannelCreator.fields.channelMoveMessage.label'), type: 'text', defaultValue: 'You have been moved to your private channel.' },
      { key: 'channelErrorMessage', label: t('data.botTemplates.items.privateChannelCreator.fields.channelErrorMessage.label'), type: 'text', defaultValue: 'Your channel could not be created. Please try again, or contact an admin if this keeps happening.' },
      { key: 'channelPasswordMessage', label: t('data.botTemplates.items.privateChannelCreator.fields.channelPasswordMessage.label'), type: 'text', defaultValue: 'Your channel was created with a password. The password is:', conditions: [{ field: 'autoGeneratePassword', value: 'yes' }] },
      { key: 'spamProtectionBanMessage', label: t('data.botTemplates.items.privateChannelCreator.fields.spamProtectionBanMessage.label'), type: 'text', defaultValue: 'You have been banned for spamming the lobby.', conditions: [{ field: 'spamProtectionEnabled', value: 'yes' }] },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const spamEnabled = cfg.spamProtectionEnabled === 'yes';
      const wantsPassword = cfg.autoGeneratePassword === 'yes';
      const isSubchannel = cfg.channelPlacement === 'sub';
      const effectiveLobbyId = cfg.parentChannelId || cfg.lobbyChannelId;
      // notifyclientmoved carries clid but not client_database_id/
      // client_unique_identifier/client_nickname - a clientinfo lookup right
      // after the trigger is the only way to get those (same gap this app
      // already worked around for chat-command triggers in Welcome Message).
      const strikeVar = `pcc_strikes_{{temp.joinerInfo.0.client_unique_identifier}}`;

      const nodes: any[] = [];
      const edges: any[] = [];
      let y = 80;
      const rowY = () => { const cur = y; y += 140; return cur; };

      const nTrigger = nid();
      nodes.push(makeNode(nTrigger, 'trigger_event', 'Client Moved', { eventName: 'notifyclientmoved' }, 40, 300));
      const nJoinedLobby = nid();
      nodes.push(makeNode(nJoinedLobby, 'condition', 'Joined Lobby?', { expression: `event.ctid == ${cfg.lobbyChannelId}` }, 280, 300));
      edges.push(makeEdge(eid(), nTrigger, nJoinedLobby));
      const nJoinerInfo = nid();
      nodes.push(makeNode(nJoinerInfo, 'action_webquery', 'Get Joiner Info', { command: 'clientinfo', params: { clid: '{{event.clid}}' }, storeAs: 'joinerInfo' }, 520, 300));
      edges.push(makeEdge(eid(), nJoinedLobby, nJoinerInfo, 'true', 'in'));
      let lastId = nJoinerInfo;
      let lastPort: string | undefined = undefined;
      let x = 760;

      if (spamEnabled) {
        const nIncrement = nid();
        nodes.push(makeNode(nIncrement, 'variable', 'Increment Strikes', { operation: 'increment', name: strikeVar, value: '1' }, x, 300));
        edges.push(makeEdge(eid(), lastId, nIncrement, lastPort, 'in'));
        x += 240;

        const nReadStrikes = nid();
        nodes.push(makeNode(nReadStrikes, 'variable', 'Read Strikes', { operation: 'get', name: strikeVar, storeAs: 'strikes' }, x, 300));
        edges.push(makeEdge(eid(), nIncrement, nReadStrikes));
        x += 240;

        const nExceeded = nid();
        nodes.push(makeNode(nExceeded, 'condition', 'Exceeded Max Strikes?', { expression: `temp.strikes > ${cfg.spamProtectionMaxStrikes || 10}` }, x, 300));
        edges.push(makeEdge(eid(), nReadStrikes, nExceeded));
        x += 240;

        const nBan = nid();
        nodes.push(makeNode(nBan, 'action_ban', 'Ban Spammer', { reason: cfg.spamProtectionBanMessage || 'You have been banned for spamming the lobby.', time: cfg.spamProtectionBanSeconds || 600 }, x, rowY()));
        edges.push(makeEdge(eid(), nExceeded, nBan, 'true', 'in'));

        lastId = nExceeded;
        lastPort = 'false';
      }

      const nCheckOwnership = nid();
      nodes.push(makeNode(nCheckOwnership, 'action_webquery', 'Check Ownership', { command: 'channelgroupclientlist', params: { cldbid: '{{temp.joinerInfo.0.client_database_id}}', cgid: cfg.channelAdminGroupId }, storeAs: 'ownership' }, x, 300));
      edges.push(makeEdge(eid(), lastId, nCheckOwnership, lastPort, 'in'));
      x += 240;

      const nAlreadyOwns = nid();
      nodes.push(makeNode(nAlreadyOwns, 'condition', 'Already Owns Channel?', { expression: 'count(temp.ownership) > 0' }, x, 300));
      edges.push(makeEdge(eid(), nCheckOwnership, nAlreadyOwns));
      x += 240;

      // --- Branch: already owns one - just move them back in ---
      const nMoveExisting = nid();
      nodes.push(makeNode(nMoveExisting, 'action_move', 'Move to Existing Channel', { channelId: '{{temp.ownership.0.cid}}' }, x, 220));
      edges.push(makeEdge(eid(), nAlreadyOwns, nMoveExisting, 'true', 'in'));
      const nMoveExistingMsg = nid();
      nodes.push(makeNode(nMoveExistingMsg, 'action_message', 'Send Move Message', { message: cfg.channelMoveMessage || 'You have been moved to your private channel.' }, x + 240, 220));
      edges.push(makeEdge(eid(), nMoveExisting, nMoveExistingMsg));

      // --- Branch: doesn't own one yet - create it ---
      let createX = x;
      let createLast = nAlreadyOwns;
      let createPort: string | undefined = 'false';

      // Declared now, wired at the end - every WebQuery step in this branch that
      // can realistically fail from a config mistake (a bad Parent Channel ID
      // override, a channel group the current identity can't actually assign)
      // reports it here instead of aborting the whole flow silently.
      const nCreateError = nid();
      const errorSources: { id: string; x: number }[] = [];

      let cpidExpr: string;
      if (isSubchannel) {
        cpidExpr = String(effectiveLobbyId);
      } else {
        const nLobbyInfo = nid();
        nodes.push(makeNode(nLobbyInfo, 'action_webquery', 'Get Lobby Parent', { command: 'channelinfo', params: { cid: effectiveLobbyId }, storeAs: 'lobbyInfo' }, createX, 400));
        edges.push(makeEdge(eid(), createLast, nLobbyInfo, createPort, 'in'));
        errorSources.push({ id: nLobbyInfo, x: createX });
        createLast = nLobbyInfo;
        createPort = undefined;
        createX += 240;
        cpidExpr = '{{temp.lobbyInfo.0.pid}}';
      }

      if (wantsPassword) {
        const nGenPassword = nid();
        nodes.push(makeNode(nGenPassword, 'action_generateCode', 'Generate Password', { length: 6, numericOnly: false, storeAs: 'channelPassword' }, createX, 400));
        edges.push(makeEdge(eid(), createLast, nGenPassword, createPort, 'in'));
        createLast = nGenPassword;
        createPort = undefined;
        createX += 240;
      }

      const channelParams: Record<string, any> = {
        channel_name: cfg.channelNameTemplate || "{{temp.joinerInfo.0.client_nickname}}'s Private Channel",
        cpid: cpidExpr,
        channel_codec: '4',
        channel_codec_quality: '6',
        channel_flag_maxclients_unlimited: '1',
        channel_codec_is_unencrypted: '1',
      };
      if (cfg.privateChannelType === 'permanent') channelParams.channel_flag_permanent = '1';
      else if (cfg.privateChannelType === 'temporary') channelParams.channel_flag_temporary = '1';
      else channelParams.channel_flag_semi_permanent = '1';
      if (cfg.channelDescriptionTemplate) channelParams.channel_description = cfg.channelDescriptionTemplate;
      if (wantsPassword) channelParams.channel_password = '{{temp.channelPassword}}';

      const nCreateChannel = nid();
      nodes.push(makeNode(nCreateChannel, 'action_channelCreate', 'Create Private Channel', { params: channelParams }, createX, 400));
      edges.push(makeEdge(eid(), createLast, nCreateChannel, createPort, 'in'));
      errorSources.push({ id: nCreateChannel, x: createX });
      createX += 240;

      const nSetOwner = nid();
      nodes.push(makeNode(nSetOwner, 'action_webquery', 'Set Owner', { command: 'setclientchannelgroup', params: { cgid: cfg.channelAdminGroupId, cid: '{{temp.lastCreatedChannelId}}', cldbid: '{{temp.joinerInfo.0.client_database_id}}' } }, createX, 400));
      edges.push(makeEdge(eid(), nCreateChannel, nSetOwner));
      errorSources.push({ id: nSetOwner, x: createX });
      const errorX = createX + 240;
      createX += 240;

      const nMoveNew = nid();
      nodes.push(makeNode(nMoveNew, 'action_move', 'Move to New Channel', { channelId: '{{temp.lastCreatedChannelId}}' }, createX, 400));
      edges.push(makeEdge(eid(), nSetOwner, nMoveNew));
      createX += 240;

      const nCreateMsg = nid();
      nodes.push(makeNode(nCreateMsg, 'action_message', 'Send Create Message', { message: cfg.channelCreateMessage || 'Your private channel has been created!' }, createX, 400));
      edges.push(makeEdge(eid(), nMoveNew, nCreateMsg));
      createX += 240;

      if (wantsPassword) {
        const nPasswordMsg = nid();
        nodes.push(makeNode(nPasswordMsg, 'action_message', 'Send Password Message', { message: `${cfg.channelPasswordMessage || 'Your channel was created with a password. The password is:'} {{temp.channelPassword}}` }, createX, 400));
        edges.push(makeEdge(eid(), nCreateMsg, nPasswordMsg));
      }

      // Error branch node, one row below the step right after Set Owner. Get Lobby Parent,
      // Create Private Channel and Set Owner all point here on failure. Set Owner, the
      // nearest, takes the automatic route; the others each get their own lane further
      // down and come up just before the input, so the orange lines only meet there. A
      // deeper lane comes up closer to the input, so no lane crosses another one's way up.
      const ERROR_Y = 560;
      nodes.push(makeNode(nCreateError, 'action_message', 'Send Error Message', { message: cfg.channelErrorMessage || 'Your channel could not be created. Please try again, or contact an admin if this keeps happening.' }, errorX, ERROR_Y));
      const laned = errorSources.length - 1;
      errorSources.reverse().forEach((src, lane) => {
        const edge: any = makeEdge(eid(), src.id, nCreateError, 'error', 'in');
        if (lane > 0) {
          const laneY = ERROR_Y + 40 + lane * 30;
          const stubX = src.x + 180 + 24; // where the error line leaves its node (editor's NODE_W + lead)
          edge.waypoints = [{ x: stubX, y: laneY }, { x: errorX - 30 - (laned - lane + 1) * 10, y: laneY }];
        }
        edges.push(edge);
      });

      return { nodes, edges };
    },
  },
  {
    id: 'auto-rank',
    name: t('data.botTemplates.items.autoRank.name'),
    description: t('data.botTemplates.items.autoRank.description'),
    category: 'automation',
    icon: Award,
    configFields: [
      { key: 'ranks', label: t('data.botTemplates.items.autoRank.fields.ranks.label'), type: 'text', placeholder: '[{"hours":10,"groupId":"7"},{"hours":50,"groupId":"8"}]', required: true },
      { key: 'mode', label: t('data.botTemplates.items.autoRank.fields.mode.label'), type: 'select', defaultValue: 'accumulatedTime', options: [{ label: t('data.botTemplates.items.autoRank.fields.mode.options.0'), value: 'accumulatedTime' }, { label: t('data.botTemplates.items.autoRank.fields.mode.options.1'), value: 'firstConnectionAge' }] },
      { key: 'excludeGroupIds', label: t('data.botTemplates.items.autoRank.fields.excludeGroupIds.label'), type: 'text', placeholder: 'e.g. Bot group ID' },
      { key: 'pollInterval', label: t('data.botTemplates.items.autoRank.fields.pollInterval.label'), type: 'select', defaultValue: '*/5 * * * *', options: [{ label: t('data.botTemplates.items.autoRank.fields.pollInterval.options.0'), value: '*/5 * * * *' }, { label: t('data.botTemplates.items.autoRank.fields.pollInterval.options.1'), value: '*/15 * * * *' }, { label: t('data.botTemplates.items.autoRank.fields.pollInterval.options.2'), value: '0 * * * *' }] },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_cron', 'Rank Timer', { cron: cfg.pollInterval || '*/5 * * * *' }, 60, 80),
          makeNode(n2, 'action_rankCheck', 'Check Ranks', { ranks: cfg.ranks || '[]', mode: cfg.mode || 'accumulatedTime', excludeGroupIds: cfg.excludeGroupIds || '' }, 300, 80),
        ],
        edges: [makeEdge(eid(), n1, n2)],
      };
    },
  },
  {
    id: 'last-seen-tracker',
    name: t('data.botTemplates.items.lastSeenTracker.name'),
    description: t('data.botTemplates.items.lastSeenTracker.description'),
    category: 'automation',
    icon: Clock,
    configFields: [],
    flowDataFactory: () => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_event', 'Client Leave', { eventName: 'notifyclientleftview' }, 60, 80),
          makeNode(n2, 'variable', 'Store Timestamp', { operation: 'set', name: 'lastseen_{{event.client_database_id}}', value: '{{time.timestamp}}' }, 300, 80),
          makeNode(n3, 'log', 'Log Leave', { level: 'info', message: '{{event.client_nickname}} left (dbid={{event.client_database_id}})' }, 540, 80),
        ],
        edges: [makeEdge(eid(), n1, n2), makeEdge(eid(), n2, n3)],
      };
    },
  },

  // ===== MODERATION =====
  {
    id: 'afk-mover',
    name: t('data.botTemplates.items.afkMover.name'),
    description: t('data.botTemplates.items.afkMover.description'),
    category: 'moderation',
    icon: Moon,
    configFields: [
      { key: 'afkChannelId', label: t('data.botTemplates.items.afkMover.fields.afkChannelId.label'), type: 'number', placeholder: '10', required: true },
      { key: 'idleThresholdSeconds', label: t('data.botTemplates.items.afkMover.fields.idleThresholdSeconds.label'), type: 'number', placeholder: '300', required: true },
      { key: 'exemptGroupIds', label: t('data.botTemplates.items.afkMover.fields.exemptGroupIds.label'), type: 'text', placeholder: '6,7' },
      { key: 'exemptChannelIds', label: t('data.botTemplates.items.afkMover.fields.exemptChannelIds.label'), type: 'text', placeholder: '12,15' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_cron', 'AFK Check', { cron: '* * * * *' }, 60, 80),
          makeNode(n2, 'action_afkMover', 'Move AFK', { afkChannelId: cfg.afkChannelId, idleThresholdSeconds: cfg.idleThresholdSeconds || '300', exemptGroupIds: cfg.exemptGroupIds || '', exemptChannelIds: cfg.exemptChannelIds || '' }, 300, 80),
        ],
        edges: [makeEdge(eid(), n1, n2)],
      };
    },
  },
  {
    id: 'idle-kicker',
    name: t('data.botTemplates.items.idleKicker.name'),
    description: t('data.botTemplates.items.idleKicker.description'),
    category: 'moderation',
    icon: Timer,
    configFields: [
      { key: 'idleThresholdSeconds', label: t('data.botTemplates.items.idleKicker.fields.idleThresholdSeconds.label'), type: 'number', placeholder: '1800', required: true },
      { key: 'reason', label: t('data.botTemplates.items.idleKicker.fields.reason.label'), type: 'text', placeholder: 'Idle timeout' },
      { key: 'exemptGroupIds', label: t('data.botTemplates.items.idleKicker.fields.exemptGroupIds.label'), type: 'text', placeholder: '6,7' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_cron', 'Idle Check', { cron: '* * * * *' }, 60, 80),
          makeNode(n2, 'action_idleKicker', 'Kick Idle', { idleThresholdSeconds: cfg.idleThresholdSeconds || '1800', reason: cfg.reason || 'Idle timeout', exemptGroupIds: cfg.exemptGroupIds || '' }, 300, 80),
        ],
        edges: [makeEdge(eid(), n1, n2)],
      };
    },
  },
  {
    id: 'bad-name-checker',
    name: t('data.botTemplates.items.badNameChecker.name'),
    description: t('data.botTemplates.items.badNameChecker.description'),
    category: 'moderation',
    icon: Shield,
    configFields: [
      { key: 'badWords', label: t('data.botTemplates.items.badNameChecker.fields.badWords.label'), type: 'text', placeholder: 'admin,moderator,test', required: true },
      { key: 'reason', label: t('data.botTemplates.items.badNameChecker.fields.reason.label'), type: 'text', placeholder: 'Forbidden nickname' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const words = (cfg.badWords || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
      // Build expression: contains(lower(event.client_nickname),'word1') or contains(...)
      const expr = words.length > 0
        ? words.map(w => `contains(lower(event.client_nickname),'${w}')`).join(' or ')
        : "contains(lower(event.client_nickname),'admin')";

      const n1 = nid(), n2 = nid(), n3 = nid(), n4 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_event', 'Client Enter', { eventName: 'notifycliententerview' }, 60, 80),
          makeNode(n2, 'condition', 'Is Human?', { expression: 'event.client_type == 0' }, 300, 80),
          makeNode(n3, 'condition', 'Bad Name?', { expression: expr }, 540, 80),
          makeNode(n4, 'action_kick', 'Kick Bad Name', { reasonid: '5', reason: cfg.reason || 'Forbidden nickname' }, 780, 80),
        ],
        edges: [
          makeEdge(eid(), n1, n2),
          makeEdge(eid(), n2, n3, 'true', 'in'),
          makeEdge(eid(), n3, n4, 'true', 'in'),
        ],
      };
    },
  },
  {
    id: 'group-protector',
    name: t('data.botTemplates.items.groupProtector.name'),
    description: t('data.botTemplates.items.groupProtector.description'),
    category: 'moderation',
    icon: Shield,
    configFields: [
      { key: 'protectedGroupId', label: t('data.botTemplates.items.groupProtector.fields.protectedGroupId.label'), type: 'number', placeholder: '8', required: true },
      { key: 'allowedGroupId', label: t('data.botTemplates.items.groupProtector.fields.allowedGroupId.label'), type: 'number', placeholder: '10', required: true },
      { key: 'action', label: t('data.botTemplates.items.groupProtector.fields.action.label'), type: 'select', defaultValue: 'kick', options: [{ label: t('data.botTemplates.items.groupProtector.fields.action.options.0'), value: 'kick' }, { label: t('data.botTemplates.items.groupProtector.fields.action.options.1'), value: 'remove' }] },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid(), n4 = nid();
      const actionNode = cfg.action === 'remove'
        ? makeNode(n4, 'action_groupRemove', 'Remove Group', { groupId: cfg.protectedGroupId }, 780, 80)
        : makeNode(n4, 'action_kick', 'Kick Intruder', { reasonid: '5', reason: 'Unauthorized group' }, 780, 80);

      return {
        nodes: [
          makeNode(n1, 'trigger_event', 'Client Enter', { eventName: 'notifycliententerview' }, 60, 80),
          makeNode(n2, 'condition', 'Has Protected?', { expression: `contains(event.client_servergroups,'${cfg.protectedGroupId}')` }, 300, 80),
          makeNode(n3, 'condition', 'Missing Auth?', { expression: `contains(event.client_servergroups,'${cfg.allowedGroupId}') == 0` }, 540, 80),
          actionNode,
        ],
        edges: [
          makeEdge(eid(), n1, n2),
          makeEdge(eid(), n2, n3, 'true', 'in'),
          makeEdge(eid(), n3, n4, 'true', 'in'),
        ],
      };
    },
  },

  // ===== INTEGRATION =====
  {
    id: 'webhook-server-message',
    name: t('data.botTemplates.items.webhookServerMessage.name'),
    description: t('data.botTemplates.items.webhookServerMessage.description'),
    category: 'integration',
    icon: Webhook,
    configFields: [
      { key: 'path', label: t('data.botTemplates.items.webhookServerMessage.fields.path.label'), type: 'text', placeholder: 'server-notify', required: true },
      { key: 'secret', label: t('data.botTemplates.items.webhookServerMessage.fields.secret.label'), type: 'text', placeholder: 'my-secret-key' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_webhook', 'Incoming Webhook', { path: cfg.path || 'server-notify', method: 'POST', secret: cfg.secret || '' }, 60, 80),
          makeNode(n2, 'action_message', 'Broadcast Message', { targetMode: '3', message: '[Webhook] {{event.webhook_body}}' }, 340, 80),
        ],
        edges: [makeEdge(eid(), n1, n2)],
      };
    },
  },
  {
    id: 'webhook-group-assign',
    name: t('data.botTemplates.items.webhookGroupAssign.name'),
    description: t('data.botTemplates.items.webhookGroupAssign.description'),
    category: 'integration',
    icon: Webhook,
    configFields: [
      { key: 'path', label: t('data.botTemplates.items.webhookGroupAssign.fields.path.label'), type: 'text', placeholder: 'verify-user', required: true },
      { key: 'groupId', label: t('data.botTemplates.items.webhookGroupAssign.fields.groupId.label'), type: 'text', placeholder: '42', required: true },
      { key: 'secret', label: t('data.botTemplates.items.webhookGroupAssign.fields.secret.label'), type: 'text', placeholder: 'my-secret-key' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_webhook', 'Verification Webhook', { path: cfg.path || 'verify-user', method: 'POST', secret: cfg.secret || '' }, 60, 80),
          makeNode(n2, 'action_webquery', 'Add to Group', { command: 'servergroupaddclient', params: { sgid: cfg.groupId, cldbid: '{{event.webhook_body.cldbid}}' } }, 340, 80),
          makeNode(n3, 'log', 'Log Result', { level: 'info', message: `Assigned group ${cfg.groupId} to cldbid {{event.webhook_body.cldbid}}` }, 600, 80),
        ],
        edges: [makeEdge(eid(), n1, n2), makeEdge(eid(), n2, n3)],
      };
    },
  },
  {
    id: 'webhook-channel-rename',
    name: t('data.botTemplates.items.webhookChannelRename.name'),
    description: t('data.botTemplates.items.webhookChannelRename.description'),
    category: 'integration',
    icon: Webhook,
    configFields: [
      { key: 'path', label: t('data.botTemplates.items.webhookChannelRename.fields.path.label'), type: 'text', placeholder: 'update-status', required: true },
      { key: 'channelId', label: t('data.botTemplates.items.webhookChannelRename.fields.channelId.label'), type: 'text', placeholder: '42', required: true },
      { key: 'nameTemplate', label: t('data.botTemplates.items.webhookChannelRename.fields.nameTemplate.label'), type: 'text', placeholder: '[STATUS] {{event.webhook_body.status}}', required: true },
      { key: 'secret', label: t('data.botTemplates.items.webhookChannelRename.fields.secret.label'), type: 'text', placeholder: 'my-secret-key' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_webhook', 'Status Webhook', { path: cfg.path || 'update-status', method: 'POST', secret: cfg.secret || '' }, 60, 80),
          makeNode(n2, 'action_channelEdit', 'Update Channel', { channelId: cfg.channelId, params: { channel_name: cfg.nameTemplate || '[STATUS] {{event.webhook_body.status}}' } }, 340, 80),
        ],
        edges: [makeEdge(eid(), n1, n2)],
      };
    },
  },
  {
    id: 'anti-vpn',
    name: t('data.botTemplates.items.antiVpn.name'),
    description: t('data.botTemplates.items.antiVpn.description'),
    category: 'integration',
    icon: Globe,
    configFields: [
      { key: 'apiUrl', label: t('data.botTemplates.items.antiVpn.fields.apiUrl.label'), type: 'text', placeholder: 'https://vpnapi.io/api/{{ip}}?key=YOUR_KEY', required: true },
      { key: 'action', label: t('data.botTemplates.items.antiVpn.fields.action.label'), type: 'select', defaultValue: 'kick', options: [{ label: t('data.botTemplates.items.antiVpn.fields.action.options.0'), value: 'kick' }, { label: t('data.botTemplates.items.antiVpn.fields.action.options.1'), value: 'ban' }] },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid(), n4 = nid(), n5 = nid();
      const url = (cfg.apiUrl || '').replace('{{ip}}', '{{event.connection_client_ip}}');
      const actionNode = cfg.action === 'ban'
        ? makeNode(n5, 'action_ban', 'Ban VPN', { time: 3600, reason: 'VPN detected' }, 1020, 80)
        : makeNode(n5, 'action_kick', 'Kick VPN', { reasonid: '5', reason: 'VPN detected' }, 1020, 80);

      return {
        nodes: [
          makeNode(n1, 'trigger_event', 'Client Enter', { eventName: 'notifycliententerview' }, 60, 80),
          makeNode(n2, 'condition', 'Is Human?', { expression: 'event.client_type == 0' }, 300, 80),
          makeNode(n3, 'action_httpRequest', 'Check VPN API', { url, method: 'GET', storeAs: 'vpn' }, 540, 80),
          makeNode(n4, 'condition', 'Is VPN?', { expression: "temp.vpn.security.vpn == true or temp.vpn.security.proxy == true" }, 780, 80),
          actionNode,
        ],
        edges: [
          makeEdge(eid(), n1, n2),
          makeEdge(eid(), n2, n3, 'true', 'in'),
          makeEdge(eid(), n3, n4),
          makeEdge(eid(), n4, n5, 'true', 'in'),
        ],
      };
    },
  },
]; }

export function getTemplateCategories(t: TFunction) {
  return [
    { id: 'info-channels', label: t('data.botTemplates.categories.infoChannels.label'), description: t('data.botTemplates.categories.infoChannels.description') },
    { id: 'moderation', label: t('data.botTemplates.categories.moderation.label'), description: t('data.botTemplates.categories.moderation.description') },
    { id: 'automation', label: t('data.botTemplates.categories.automation.label'), description: t('data.botTemplates.categories.automation.description') },
    { id: 'integration', label: t('data.botTemplates.categories.integration.label'), description: t('data.botTemplates.categories.integration.description') },
  ];
}
