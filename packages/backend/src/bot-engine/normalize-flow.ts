import type { FlowDefinition, FlowNode, FlowEdge } from '@ts6/common';

/**
 * Normalize flow data from the frontend editor format to the engine format.
 *
 * Editor format:
 *   node: { id, type: "trigger_event"/"action_kick"/etc, label, config: { eventName, reason, ... }, x, y }
 *   edge: { id, source, sourcePort, target, targetPort }
 *
 * Engine format (matches @ts6/common types):
 *   node: { id, type: "trigger"/"action"/etc, position: {x,y}, data: { triggerType/actionType, label, ...config } }
 *   edge: { id, source, target, sourceHandle }
 *
 * Config field mappings:
 *   trigger_event:   { eventName } → { triggerType:'event', eventName }
 *   trigger_cron:    { cron } → { triggerType:'cron', cronExpression: cron }
 *   trigger_webhook: { path } → { triggerType:'webhook', webhookPath: path }
 *   trigger_command: { command } → { triggerType:'command', commandPrefix:'!', commandName: command }
 *   trigger_support: { queueId } → { triggerType:'support', supportEvent:'taken', queueId } (no SSH; fired by the support queue)
 *   action_supportEnqueue: { queueId } → { actionType:'supportEnqueue', queueId }
 *   action_kick:     { reasonid, reason } → { actionType:'kick', reasonId: parseInt(reasonid)||5, reasonMsg: reason }
 *   action_ban:      { time, reason } → { actionType:'ban', duration: time, reason }
 *   action_move:     { channelId } → { actionType:'move', channelId }
 *   action_message:  { targetMode, message } → { actionType:'message', targetMode: modeMap, message }
 *   condition:       { expression } → { nodeType:'condition', expression }
 *   delay:           { delay } → { nodeType:'delay', delayMs: delay }
 *   variable:        { operation, name, value, storeAs } → { nodeType:'variable', operation, variableName: name, value, storeAs } (also accepts legacy varName/varValue keys; storeAs only used when operation is 'get', to name the temp.* slot the read value lands in)
 *   log:             { level, message } → { nodeType:'log', level, message }
 *   loop:            { arrayVariable, itemVariable, maxIterations } → { nodeType:'loop', arrayVariable, itemVariable, maxIterations }
 */
export function normalizeFlowData(raw: any): FlowDefinition {
  const targetModeMap: Record<string, number> = { client: 1, channel: 2, server: 3 };

  const nodes: FlowNode[] = (raw.nodes || []).map((n: any) => {
    const nodeType: string = n.type || '';

    // Already in engine format?
    if (n.data && (n.data.triggerType || n.data.actionType || n.data.nodeType)) {
      return { ...n, position: n.position || { x: n.x || 0, y: n.y || 0 } };
    }

    const config = n.config || {};
    const label = n.label || nodeType.replace(/_/g, ' ');
    const position = n.position || { x: n.x || 0, y: n.y || 0 };
    let type: string;
    let data: any;

    if (nodeType === 'trigger_event') {
      type = 'trigger';
      data = { triggerType: 'event', label, eventName: config.eventName || '', filters: config.filters };
    } else if (nodeType === 'trigger_cron') {
      type = 'trigger';
      data = { triggerType: 'cron', label, cronExpression: config.cron || config.cronExpression || '', timezone: config.timezone || undefined };
    } else if (nodeType === 'trigger_webhook') {
      type = 'trigger';
      data = { triggerType: 'webhook', label, webhookPath: config.path || config.webhookPath || '', method: config.method || 'POST', secret: config.secret || undefined };
    } else if (nodeType === 'trigger_command') {
      type = 'trigger';
      const cmd = config.command || '';
      const prefix = cmd.startsWith('!') ? '!' : config.commandPrefix || '!';
      const name = cmd.startsWith('!') ? cmd.substring(1) : cmd;
      data = { triggerType: 'command', label, commandPrefix: prefix, commandName: name, channelId: config.channelId ? String(config.channelId) : undefined, };
    } else if (nodeType === 'trigger_support') {
      type = 'trigger';
      data = { triggerType: 'support', label, supportEvent: 'taken', queueId: config.queueId ? String(config.queueId) : '' };
    } else if (nodeType === 'action_supportEnqueue') {
      type = 'action';
      data = { actionType: 'supportEnqueue', label, queueId: config.queueId ? String(config.queueId) : '' };
    } else if (nodeType === 'action_kick') {
      type = 'action';
      data = { actionType: 'kick', label, reasonId: parseInt(config.reasonid) || 5, reasonMsg: config.reason || '' };
    } else if (nodeType === 'action_ban') {
      type = 'action';
      data = { actionType: 'ban', label, duration: config.time || 0, reason: config.reason || '' };
    } else if (nodeType === 'action_move') {
      type = 'action';
      data = { actionType: 'move', label, channelId: config.channelId || config.cid || '' };
    } else if (nodeType === 'action_message') {
      type = 'action';
      data = { actionType: 'message', label, targetMode: targetModeMap[config.targetMode] || 1, message: config.message || '', target: config.target };
    } else if (nodeType === 'action_poke') {
      type = 'action';
      data = { actionType: 'poke', label, message: config.message || '' };
    } else if (nodeType === 'action_channelCreate') {
      type = 'action';
      const params: Record<string, string> = {};
      if (config.channel_name) params.channel_name = config.channel_name;
      if (config.cpid) params.cpid = config.cpid;
      const tmp = String(config.channel_flag_temporary ?? '');
      const semi = String(config.channel_flag_semi_permanent ?? '');
      if (tmp === '1') {
        params.channel_flag_temporary = '1';
      } else if (semi === '1') {
        params.channel_flag_semi_permanent = '1';
      }
      // If neither flag is '1', channel will be permanent (TS3 default)
      if (config.channel_topic) params.channel_topic = config.channel_topic;
      if (config.channel_password) params.channel_password = config.channel_password;
      data = { actionType: 'channelCreate', label, params: { ...params, ...config.params } };
    } else if (nodeType === 'action_channelEdit') {
      type = 'action';
      const params: Record<string, string> = {};
      if (config.channel_name) params.channel_name = config.channel_name;
      if (config.channel_topic) params.channel_topic = config.channel_topic;
      if (config.channel_description) params.channel_description = config.channel_description;
      if (config.channel_maxclients) params.channel_maxclients = config.channel_maxclients;
      if (config.channel_password) params.channel_password = config.channel_password;
      data = { actionType: 'channelEdit', label, channelId: config.channelId || config.cid || '', params: { ...params, ...config.params } };
    } else if (nodeType === 'action_channelDelete') {
      type = 'action';
      data = { actionType: 'channelDelete', label, channelId: config.channelId || config.cid || '', force: !!config.force };
    } else if (nodeType === 'action_groupAdd') {
      type = 'action';
      data = { actionType: 'groupAddClient', label, groupId: config.groupId || '' };
    } else if (nodeType === 'action_groupRemove') {
      type = 'action';
      data = { actionType: 'groupRemoveClient', label, groupId: config.groupId || '' };
    } else if (nodeType === 'action_webquery') {
      type = 'action';
      data = { actionType: 'webquery', label, command: config.command || '', params: config.params || {}, storeAs: config.storeAs || undefined };
    } else if (nodeType === 'action_webhook') {
      type = 'action';
      data = { actionType: 'webhook', label, url: config.url || '', method: config.method || 'POST', headers: config.headers, body: config.body, storeAs: config.storeAs || undefined };
    } else if (nodeType === 'action_httpRequest') {
      type = 'action';
      data = { actionType: 'httpRequest', label, url: config.url || '', method: config.method || 'GET', headers: config.headers, body: config.body, storeAs: config.storeAs || undefined };
    } else if (nodeType === 'action_afkMover') {
      type = 'action';
      data = { actionType: 'afkMover', label, afkChannelId: config.afkChannelId || '', idleThresholdSeconds: parseInt(config.idleThresholdSeconds) || 300, exemptGroupIds: config.exemptGroupIds || '', exemptChannelIds: config.exemptChannelIds || '' };
    } else if (nodeType === 'action_idleKicker') {
      type = 'action';
      data = { actionType: 'idleKicker', label, idleThresholdSeconds: parseInt(config.idleThresholdSeconds) || 1800, reason: config.reason || '', exemptGroupIds: config.exemptGroupIds || '' };
    } else if (nodeType === 'action_pokeGroup') {
      type = 'action';
      data = { actionType: 'pokeGroup', label, groupId: config.groupId || '', message: config.message || '' };
    } else if (nodeType === 'action_rankCheck') {
      type = 'action';
      data = { actionType: 'rankCheck', label, ranks: config.ranks || '[]', mode: config.mode || 'accumulatedTime', excludeGroupIds: config.excludeGroupIds || '' };
    } else if (nodeType === 'action_tempChannelCleanup') {
      type = 'action';
      data = { actionType: 'tempChannelCleanup', label, parentChannelId: config.parentChannelId || '', protectedChannelIds: config.protectedChannelIds || '' };
    } else if (nodeType === 'action_voicePlay') {
      type = 'action';
      data = { actionType: 'voicePlay', label, botId: config.botId || '', songId: config.songId || '', playlistId: config.playlistId || '' };
    } else if (nodeType === 'action_voiceStop') {
      type = 'action';
      data = { actionType: 'voiceStop', label, botId: config.botId || '' };
    } else if (nodeType === 'action_voiceJoinChannel') {
      type = 'action';
      data = { actionType: 'voiceJoinChannel', label, botId: config.botId || '', channelId: config.channelId || '', channelPassword: config.channelPassword || '' };
    } else if (nodeType === 'action_voiceLeaveChannel') {
      type = 'action';
      data = { actionType: 'voiceLeaveChannel', label, botId: config.botId || '' };
    } else if (nodeType === 'action_voiceVolume') {
      type = 'action';
      data = { actionType: 'voiceVolume', label, botId: config.botId || '', volume: config.volume || '50' };
    } else if (nodeType === 'action_voicePauseResume') {
      type = 'action';
      data = { actionType: 'voicePauseResume', label, botId: config.botId || '', action: config.action || 'toggle' };
    } else if (nodeType === 'action_voiceSkip') {
      type = 'action';
      data = { actionType: 'voiceSkip', label, botId: config.botId || '', direction: config.direction || 'next' };
    } else if (nodeType === 'action_voiceSeek') {
      type = 'action';
      data = { actionType: 'voiceSeek', label, botId: config.botId || '', position: config.position || '0' };
    } else if (nodeType === 'action_voiceTts') {
      type = 'action';
      data = { actionType: 'voiceTts', label, botId: config.botId || '', text: config.text || '', language: config.language || '' };
    } else if (nodeType === 'action_animatedChannel') {
      type = 'action';
      data = { actionType: 'animatedChannel', label, channelId: config.channelId || '', text: config.text || '', style: config.style || 'scroll', intervalSeconds: config.intervalSeconds || '3', prefix: config.prefix ?? '[cspacer]', timezone: config.timezone || undefined };
    } else if (nodeType === 'condition') {
      type = 'condition';
      data = { nodeType: 'condition', label, expression: config.expression || '' };
    } else if (nodeType === 'delay') {
      type = 'delay';
      data = { nodeType: 'delay', label, delayMs: config.delay || config.delayMs || 1000 };
    } else if (nodeType === 'variable') {
      type = 'variable';
      data = { nodeType: 'variable', label, operation: config.operation || 'set', variableName: config.name || config.varName || '', value: config.value || config.varValue || '', storeAs: config.storeAs || 'variableValue' };
    } else if (nodeType === 'action_generateCode') {
      type = 'action';
      data = { actionType: 'generateCode', label, length: parseInt(config.length, 10) || 5, storeAs: config.storeAs || 'code', numericOnly: config.numericOnly !== false, };
    } else if (nodeType === 'action_countOnlineInGroups') {
      type = 'action';
      data = { actionType: 'countOnlineInGroups', label, groupIds: config.groupIds || '', excludeChannelIds: config.excludeChannelIds || '', storeAs: config.storeAs || 'onlineCount' };
    } else if (nodeType === 'action_listMembership') {
      type = 'action';
      data = { actionType: 'listMembership', label, listName: config.listName || '', operation: config.operation || 'add', value: config.value || '' };
    } else if (nodeType === 'log') {
      type = 'log';
      data = { nodeType: 'log', label, level: config.level || 'info', message: config.message || '' };
    } else if (nodeType === 'loop') {
      type = 'loop';
      const maxIterations = config.maxIterations ? parseInt(config.maxIterations, 10) : undefined;
      data = { nodeType: 'loop', label, arrayVariable: config.arrayVariable || '', itemVariable: config.itemVariable || 'item', maxIterations: maxIterations && maxIterations > 0 ? maxIterations : undefined };
    } else {
      // Pass through unknown types
      type = nodeType;
      data = { label, ...config };
    }

    return { id: n.id, type, position, data } as FlowNode;
  });

  const edges: FlowEdge[] = (raw.edges || []).map((e: any) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || e.sourcePort || undefined,
    label: e.label || undefined,
  }));

  return { nodes, edges };
}
