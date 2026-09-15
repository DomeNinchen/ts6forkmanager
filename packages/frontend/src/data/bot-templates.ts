import { Clock, Users, Shield, Globe, Zap, MessageSquare, Moon, Timer, Megaphone, Award, FolderPlus, Eye, Webhook, Sparkles } from 'lucide-react';

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
const nid = () => `tpl_${++_id}`;
const eid = () => `tpl_e${_id}`;

function resetIds() { _id = 0; }

// Helper to build a simple linear flow
function makeNode(id: string, type: string, label: string, config: Record<string, any>, x: number, y: number) {
  return { id, type, label, config, x, y };
}
function makeEdge(id: string, source: string, target: string, sourcePort = 'out', targetPort = 'in') {
  return { id, source, sourcePort, target, targetPort };
}

const DEFAULT_WELCOME_MESSAGE = 'Welcome {{event.client_nickname}}!\nOnline: {{temp.onlineCount}} | Team online: {{temp.teamOnline}}\nThis is your {{temp.dbInfo.0.client_totalconnections}}. visit.';

export const BOT_TEMPLATES: BotTemplate[] = [
  // ===== INFO CHANNELS =====
  {
    id: 'clock-channel',
    name: 'Clock Channel',
    description: 'Updates a channel name with the current time every minute.',
    category: 'info-channels',
    icon: Clock,
    configFields: [
      { key: 'channelId', label: 'Channel ID', type: 'number', placeholder: '42', required: true },
      { key: 'timezone', label: 'Timezone', type: 'select', defaultValue: 'Europe/Berlin', options: [
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
    name: 'Online Counter',
    description: 'Shows the current online client count in a channel name.',
    category: 'info-channels',
    icon: Users,
    configFields: [
      { key: 'channelId', label: 'Channel ID', type: 'number', placeholder: '43', required: true },
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
    name: 'Server Stats',
    description: 'Displays uptime, online clients, and channel count in three info channels.',
    category: 'info-channels',
    icon: Eye,
    configFields: [
      { key: 'uptimeChannelId', label: 'Uptime Channel ID', type: 'number', placeholder: '44', required: true },
      { key: 'clientsChannelId', label: 'Clients Channel ID', type: 'number', placeholder: '45', required: true },
      { key: 'channelCountChannelId', label: 'Channel Count Channel ID', type: 'number', placeholder: '46', required: true },
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
    name: 'Animated Channel Name',
    description: 'Animates a channel name with visual effects like scrolling marquee, typewriter, bounce, and more. Updates every 2-5 seconds.',
    category: 'info-channels',
    icon: Sparkles,
    configFields: [
      { key: 'channelId', label: 'Channel ID', type: 'number', placeholder: '42', required: true },
      { key: 'text', label: 'Display Text', type: 'text', placeholder: 'Welcome to MyServer', required: true },
      { key: 'style', label: 'Animation Style', type: 'select', defaultValue: 'scroll', options: [
        { label: 'Scroll Left (Marquee)', value: 'scroll' },
        { label: 'Typewriter', value: 'typewriter' },
        { label: 'Bounce', value: 'bounce' },
        { label: 'Blink', value: 'blink' },
        { label: 'Wave (Decorative)', value: 'wave' },
        { label: 'Alternate Case', value: 'alternateCase' },
      ] },
      { key: 'intervalSeconds', label: 'Speed', type: 'select', defaultValue: '3', options: [
        { label: 'Slow (5s)', value: '5' },
        { label: 'Medium (3s)', value: '3' },
        { label: 'Fast (2s)', value: '2' },
        { label: 'Very Fast (1s)', value: '1' },
        { label: 'Ultra (0.5s)', value: '0.5' },
        { label: 'Insane (0.25s)', value: '0.25' },
      ] },
      { key: 'prefix', label: 'Channel Name Prefix', type: 'text', placeholder: '[cspacer]', defaultValue: '[cspacer]' },
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
    name: 'Welcome Message',
    description: 'Sends a welcome message or poke when a client joins the server, with an opt-out command and server-group exclusions.',
    category: 'automation',
    icon: MessageSquare,
    variablesHint: [
      '{{event.client_nickname}} - joining client\'s name',
      '{{temp.onlineCount}} - real users online right now (query/bot connections not counted)',
      '{{temp.dbInfo.0.client_totalconnections}} - this client\'s lifetime connection count',
      '{{temp.teamOnline}} - team members online right now (only resolves if Team Groups is set below)',
    ],
    configFields: [
      { key: 'message', label: 'Welcome Message', type: 'textarea', placeholder: DEFAULT_WELCOME_MESSAGE },
      { key: 'usePokeInstead', label: 'Delivery Method', type: 'select', defaultValue: 'message', options: [{ label: 'Private Message', value: 'message' }, { label: 'Poke', value: 'poke' }] },
      { key: 'ignoreGroupIds', label: 'Ignore Groups (comma-separated, optional)', type: 'text', placeholder: 'e.g. Music Bot / Team server group IDs - these clients never get a welcome message' },
      { key: 'teamGroupIds', label: 'Team Groups for {{temp.teamOnline}} (comma-separated, optional)', type: 'text', placeholder: 'e.g. 6,7' },
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
    id: 'support-system',
    name: 'Support System',
    description: 'Notifies admins when a client joins the support channel.',
    category: 'automation',
    icon: Megaphone,
    configFields: [
      { key: 'supportChannelId', label: 'Support Channel ID', type: 'number', placeholder: '15', required: true },
      { key: 'adminGroupId', label: 'Admin Group ID', type: 'number', placeholder: '6', required: true },
      { key: 'message', label: 'Notification Message', type: 'text', placeholder: 'Support needed by {{event.client_nickname}}!' },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid(), n4 = nid();
      return {
        nodes: [
          makeNode(n1, 'trigger_event', 'Client Moved', { eventName: 'notifyclientmoved' }, 60, 80),
          makeNode(n2, 'condition', 'Joined Support?', { expression: `event.ctid == ${cfg.supportChannelId}` }, 300, 80),
          makeNode(n3, 'action_webquery', 'Get Client Info', { command: 'clientinfo clid={{event.clid}}', storeAs: 'client' }, 540, 40),
          makeNode(n4, 'action_pokeGroup', 'Notify Admins', { groupId: cfg.adminGroupId, message: cfg.message || 'Support needed by {{temp.client.0.client_nickname}}!' }, 780, 40),
        ],
        edges: [
          makeEdge(eid(), n1, n2),
          makeEdge(eid(), n2, n3, 'true', 'in'),
          makeEdge(eid(), n3, n4),
        ],
      };
    },
  },
  {
    // Rebuilt from the ground up, inspired by (and adapted for this app's own
    // engine from) the "Private Channel Manager" plugin for SinusBot by
    // Smorrebrod / Cedrik Paetz <cedrik.paetz@gmail.com> - credit to the
    // original design this template's shape and field set is based on.
    id: 'private-channel-creator',
    name: 'Private Channel Creator',
    description: 'Creates a persistent private channel for a client on first joining a lobby, and moves them back to it every time after - with them set as its channel owner.',
    category: 'automation',
    icon: FolderPlus,
    variablesHint: [
      '{{temp.joinerInfo.0.client_nickname}} - joining client\'s name (for the channel name/description template)',
    ],
    configFields: [
      { key: 'lobbyChannelId', label: 'Lobby Channel ID', type: 'number', placeholder: '20', required: true },
      { key: 'parentChannelId', label: 'Parent Channel ID (optional - overrides where channels are created)', type: 'number', placeholder: 'e.g. 19' },
      { key: 'channelPlacement', label: 'Channel Placement', type: 'select', defaultValue: 'sibling', options: [{ label: 'Standard Channel (next to Lobby)', value: 'sibling' }, { label: 'Subchannel of Lobby', value: 'sub' }] },
      { key: 'channelAdminGroupId', label: 'Channel Admin Group ID (assigned as owner)', type: 'number', placeholder: '5', required: true },
      { key: 'channelNameTemplate', label: 'Channel Name Template', type: 'text', defaultValue: "{{temp.joinerInfo.0.client_nickname}}'s Private Channel" },
      { key: 'channelDescriptionTemplate', label: 'Channel Description Template (optional)', type: 'textarea', placeholder: 'e.g. Private channel of {{temp.joinerInfo.0.client_nickname}}, created {{time.date}}' },
      { key: 'privateChannelType', label: 'Private Channel Type', type: 'select', defaultValue: 'semipermanent', options: [{ label: 'Permanent', value: 'permanent' }, { label: 'Semi-Permanent', value: 'semipermanent' }, { label: 'Temporary (TeamSpeak deletes it once empty)', value: 'temporary' }] },
      { key: 'autoGeneratePassword', label: 'Password Protection', type: 'select', defaultValue: 'no', options: [{ label: 'None', value: 'no' }, { label: 'Auto-generate', value: 'yes' }] },
      { key: 'spamProtectionEnabled', label: 'Spam Protection (ban clients who repeatedly rejoin the lobby)', type: 'select', defaultValue: 'no', options: [{ label: 'No', value: 'no' }, { label: 'Yes', value: 'yes' }] },
      { key: 'spamProtectionMaxStrikes', label: 'Max Strikes Before Ban', type: 'number', defaultValue: '10', indent: 1, conditions: [{ field: 'spamProtectionEnabled', value: 'yes' }] },
      { key: 'spamProtectionBanSeconds', label: 'Ban Duration (seconds)', type: 'number', defaultValue: '600', indent: 1, conditions: [{ field: 'spamProtectionEnabled', value: 'yes' }] },
      { key: 'channelCreateMessage', label: 'Channel Create Message', type: 'text', defaultValue: 'Your private channel has been created!' },
      { key: 'channelMoveMessage', label: 'Channel Move Message', type: 'text', defaultValue: 'You have been moved to your private channel.' },
      { key: 'channelErrorMessage', label: 'Channel Error Message', type: 'text', defaultValue: 'Your channel could not be created. Please try again, or contact an admin if this keeps happening.' },
      { key: 'channelPasswordMessage', label: 'Channel Password Message', type: 'text', defaultValue: 'Your channel was created with a password. The password is:', conditions: [{ field: 'autoGeneratePassword', value: 'yes' }] },
      { key: 'spamProtectionBanMessage', label: 'Spam Protection Ban Message', type: 'text', defaultValue: 'You have been banned for spamming the lobby.', conditions: [{ field: 'spamProtectionEnabled', value: 'yes' }] },
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

      // Declared now, wired to below - every WebQuery step in this branch that
      // can realistically fail from a config mistake (a bad Parent Channel ID
      // override, a channel group the current identity can't actually assign)
      // reports it here instead of aborting the whole flow silently.
      const nCreateError = nid();

      let cpidExpr: string;
      if (isSubchannel) {
        cpidExpr = String(effectiveLobbyId);
      } else {
        const nLobbyInfo = nid();
        nodes.push(makeNode(nLobbyInfo, 'action_webquery', 'Get Lobby Parent', { command: 'channelinfo', params: { cid: effectiveLobbyId }, storeAs: 'lobbyInfo' }, createX, 400));
        edges.push(makeEdge(eid(), createLast, nLobbyInfo, createPort, 'in'));
        edges.push(makeEdge(eid(), nLobbyInfo, nCreateError, 'error', 'in'));
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
      edges.push(makeEdge(eid(), nCreateChannel, nCreateError, 'error', 'in'));
      createX += 240;

      const nSetOwner = nid();
      nodes.push(makeNode(nSetOwner, 'action_webquery', 'Set Owner', { command: 'setclientchannelgroup', params: { cgid: cfg.channelAdminGroupId, cid: '{{temp.lastCreatedChannelId}}', cldbid: '{{temp.joinerInfo.0.client_database_id}}' } }, createX, 400));
      edges.push(makeEdge(eid(), nCreateChannel, nSetOwner));
      edges.push(makeEdge(eid(), nSetOwner, nCreateError, 'error', 'in'));
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

      // Error branch node - see the three error edges wired above (Get Lobby
      // Parent, Create Private Channel, Set Owner all point here on failure).
      nodes.push(makeNode(nCreateError, 'action_message', 'Send Error Message', { message: cfg.channelErrorMessage || 'Your channel could not be created. Please try again, or contact an admin if this keeps happening.' }, createX, 560));

      return { nodes, edges };
    },
  },
  {
    id: 'auto-rank',
    name: 'Auto-Rank',
    description: 'Automatically assigns server groups based on cumulative online time.',
    category: 'automation',
    icon: Award,
    configFields: [
      { key: 'ranks', label: 'Ranks (JSON)', type: 'text', placeholder: '[{"hours":10,"groupId":"7"},{"hours":50,"groupId":"8"}]', required: true },
      { key: 'mode', label: 'Hours measured as', type: 'select', defaultValue: 'accumulatedTime', options: [{ label: 'Actual online time (accumulated across sessions)', value: 'accumulatedTime' }, { label: 'Time since first connection (member age)', value: 'firstConnectionAge' }] },
      { key: 'excludeGroupIds', label: 'Exclude Group IDs (comma-separated, optional)', type: 'text', placeholder: 'e.g. Bot group ID' },
      { key: 'pollInterval', label: 'Check Interval', type: 'select', defaultValue: '*/5 * * * *', options: [{ label: 'Every 5 min', value: '*/5 * * * *' }, { label: 'Every 15 min', value: '*/15 * * * *' }, { label: 'Every hour', value: '0 * * * *' }] },
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
    name: 'Last-Seen Tracker',
    description: 'Records the last-seen timestamp when a client disconnects.',
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
    name: 'AFK Mover',
    description: 'Moves idle clients to an AFK channel after a configurable timeout.',
    category: 'moderation',
    icon: Moon,
    configFields: [
      { key: 'afkChannelId', label: 'AFK Channel ID', type: 'number', placeholder: '10', required: true },
      { key: 'idleThresholdSeconds', label: 'Idle Threshold (seconds)', type: 'number', placeholder: '300', required: true },
      { key: 'exemptGroupIds', label: 'Exempt Group IDs (comma-separated)', type: 'text', placeholder: '6,7' },
      { key: 'exemptChannelIds', label: 'Exempt Channel IDs (comma-separated)', type: 'text', placeholder: '12,15' },
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
    name: 'Idle Kicker',
    description: 'Kicks clients that have been idle for too long.',
    category: 'moderation',
    icon: Timer,
    configFields: [
      { key: 'idleThresholdSeconds', label: 'Idle Threshold (seconds)', type: 'number', placeholder: '1800', required: true },
      { key: 'reason', label: 'Kick Reason', type: 'text', placeholder: 'Idle timeout' },
      { key: 'exemptGroupIds', label: 'Exempt Group IDs (comma-separated)', type: 'text', placeholder: '6,7' },
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
    name: 'Bad Name Checker',
    description: 'Kicks clients whose nickname contains forbidden words.',
    category: 'moderation',
    icon: Shield,
    configFields: [
      { key: 'badWords', label: 'Bad Words (comma-separated)', type: 'text', placeholder: 'admin,moderator,test', required: true },
      { key: 'reason', label: 'Kick Reason', type: 'text', placeholder: 'Forbidden nickname' },
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
          makeNode(n3, 'condition', 'Bad Name?', { expression: expr }, 540, 40),
          makeNode(n4, 'action_kick', 'Kick Bad Name', { reasonid: '5', reason: cfg.reason || 'Forbidden nickname' }, 780, 0),
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
    name: 'Group Protector',
    description: 'Kicks clients who have a protected group but lack the required authorization group.',
    category: 'moderation',
    icon: Shield,
    configFields: [
      { key: 'protectedGroupId', label: 'Protected Group ID', type: 'number', placeholder: '8', required: true },
      { key: 'allowedGroupId', label: 'Authorized Group ID', type: 'number', placeholder: '10', required: true },
      { key: 'action', label: 'Action', type: 'select', defaultValue: 'kick', options: [{ label: 'Kick', value: 'kick' }, { label: 'Remove Group', value: 'remove' }] },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid(), n4 = nid();
      const actionNode = cfg.action === 'remove'
        ? makeNode(n4, 'action_groupRemove', 'Remove Group', { groupId: cfg.protectedGroupId }, 780, 0)
        : makeNode(n4, 'action_kick', 'Kick Intruder', { reasonid: '5', reason: 'Unauthorized group' }, 780, 0);

      return {
        nodes: [
          makeNode(n1, 'trigger_event', 'Client Enter', { eventName: 'notifycliententerview' }, 60, 80),
          makeNode(n2, 'condition', 'Has Protected?', { expression: `contains(event.client_servergroups,'${cfg.protectedGroupId}')` }, 300, 80),
          makeNode(n3, 'condition', 'Missing Auth?', { expression: `contains(event.client_servergroups,'${cfg.allowedGroupId}') == 0` }, 540, 40),
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
    name: 'Webhook → Server Message',
    description: 'Receives a webhook POST and broadcasts the message to the TeamSpeak server. Great for monitoring alerts, CI/CD notifications, or Discord bridges.',
    category: 'integration',
    icon: Webhook,
    configFields: [
      { key: 'path', label: 'Webhook Path', type: 'text', placeholder: 'server-notify', required: true },
      { key: 'secret', label: 'Secret (optional)', type: 'text', placeholder: 'my-secret-key' },
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
    name: 'Webhook → Assign Group',
    description: 'External system (e.g. website verification) sends a webhook with a client database ID to assign a server group. Use for website-to-TS3 user verification.',
    category: 'integration',
    icon: Webhook,
    configFields: [
      { key: 'path', label: 'Webhook Path', type: 'text', placeholder: 'verify-user', required: true },
      { key: 'groupId', label: 'Server Group ID to assign', type: 'text', placeholder: '42', required: true },
      { key: 'secret', label: 'Secret (optional)', type: 'text', placeholder: 'my-secret-key' },
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
    name: 'Webhook → Update Channel',
    description: 'Receives a webhook and updates a channel name. Use for external status displays like game server status, stream status, or monitoring dashboards.',
    category: 'integration',
    icon: Webhook,
    configFields: [
      { key: 'path', label: 'Webhook Path', type: 'text', placeholder: 'update-status', required: true },
      { key: 'channelId', label: 'Channel ID to update', type: 'text', placeholder: '42', required: true },
      { key: 'nameTemplate', label: 'Channel Name Template', type: 'text', placeholder: '[STATUS] {{event.webhook_body.status}}', required: true },
      { key: 'secret', label: 'Secret (optional)', type: 'text', placeholder: 'my-secret-key' },
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
    name: 'Anti-VPN',
    description: 'Checks connecting clients against a VPN detection API and kicks/bans VPN users.',
    category: 'integration',
    icon: Globe,
    configFields: [
      { key: 'apiUrl', label: 'API URL (use {{ip}} placeholder)', type: 'text', placeholder: 'https://vpnapi.io/api/{{ip}}?key=YOUR_KEY', required: true },
      { key: 'action', label: 'Action for VPN', type: 'select', defaultValue: 'kick', options: [{ label: 'Kick', value: 'kick' }, { label: 'Ban (1h)', value: 'ban' }] },
    ],
    flowDataFactory: (cfg) => {
      resetIds();
      const n1 = nid(), n2 = nid(), n3 = nid(), n4 = nid(), n5 = nid();
      const url = (cfg.apiUrl || '').replace('{{ip}}', '{{event.connection_client_ip}}');
      const actionNode = cfg.action === 'ban'
        ? makeNode(n5, 'action_ban', 'Ban VPN', { time: 3600, reason: 'VPN detected' }, 780, 0)
        : makeNode(n5, 'action_kick', 'Kick VPN', { reasonid: '5', reason: 'VPN detected' }, 780, 0);

      return {
        nodes: [
          makeNode(n1, 'trigger_event', 'Client Enter', { eventName: 'notifycliententerview' }, 60, 80),
          makeNode(n2, 'condition', 'Is Human?', { expression: 'event.client_type == 0' }, 300, 80),
          makeNode(n3, 'action_httpRequest', 'Check VPN API', { url, method: 'GET', storeAs: 'vpn' }, 540, 40),
          makeNode(n4, 'condition', 'Is VPN?', { expression: "temp.vpn.security.vpn == true or temp.vpn.security.proxy == true" }, 540, 120),
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
];

export const TEMPLATE_CATEGORIES = [
  { id: 'info-channels', label: 'Info Channels', description: 'Dynamic channel names with live data' },
  { id: 'moderation', label: 'Moderation', description: 'Automated moderation and protection' },
  { id: 'automation', label: 'Automation', description: 'Welcome messages, temp channels, ranking' },
  { id: 'integration', label: 'Integration', description: 'External APIs and webhooks' },
] as const;
