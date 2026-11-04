import { TS_EVENTS, type TSEventName } from './events.js';

// Which fields a flow's event data carries for each TeamSpeak event, measured on
// TeamSpeak 6.0.0-beta13.1 (2026-11-04) by provoking every event against a real
// server and reading what reached the flow. `main` is what a flow typically reads
// (the flow test pre-fills these); `more` lists the rest. `changes`: the event also
// carries every changed property under its own name (channel_name, virtualserver_name,
// a new channel's flags), which differs from event to event. null: not measured -
// nothing reliable to show.

export interface TSEventFields {
  main: readonly string[];
  more: readonly string[];
  changes?: true;
}

const INVOKER = ['invokerid', 'invokername', 'invokeruid'] as const;

export const TS_EVENT_FIELDS: Readonly<Record<TSEventName, TSEventFields | null>> = {
  [TS_EVENTS.CLIENT_ENTER]: {
    main: ['clid', 'client_database_id', 'client_nickname', 'client_unique_identifier', 'client_servergroups', 'client_type', 'ctid', 'client_country'],
    more: [
      'cfid', 'reasonid', 'client_input_muted', 'client_output_muted', 'client_outputonly_muted', 'client_input_hardware',
      'client_output_hardware', 'client_meta_data', 'client_is_recording', 'client_is_streaming', 'client_channel_group_id',
      'client_away', 'client_away_message', 'client_flag_avatar', 'client_talk_power', 'client_talk_request', 'client_talk_request_msg',
      'client_description', 'client_is_talker', 'client_is_priority_speaker', 'client_unread_messages', 'client_nickname_phonetic',
      'client_needed_serverquery_view_power', 'client_icon_id', 'client_is_channel_commander', 'client_channel_group_inherited_channel_id',
      'client_badges', 'client_myteamspeak_id', 'client_integrations', 'client_myteamspeak_avatar', 'client_signed_badges', 'client_user_tag',
    ],
  },
  [TS_EVENTS.CLIENT_LEFT]: { main: ['clid', 'reasonid', 'reasonmsg', 'cfid', 'ctid'], more: [] },
  [TS_EVENTS.CLIENT_MOVED]: { main: ['clid', 'ctid', 'cfid', 'reasonid', ...INVOKER], more: [] },
  [TS_EVENTS.SERVER_EDITED]: { main: [...INVOKER], more: [], changes: true },
  [TS_EVENTS.CHANNEL_EDITED]: { main: ['cid', 'reasonid', ...INVOKER], more: [], changes: true },
  [TS_EVENTS.CHANNEL_DESCRIPTION_CHANGED]: { main: ['cid'], more: [] },
  [TS_EVENTS.CHANNEL_CREATED]: { main: ['cid', 'cpid', 'channel_name', ...INVOKER], more: ['channel_order', 'channel_unique_identifier'], changes: true },
  [TS_EVENTS.CHANNEL_DELETED]: { main: ['cid', ...INVOKER], more: [] },
  [TS_EVENTS.CHANNEL_MOVED]: { main: ['cid', 'cpid', 'order', 'reasonid', ...INVOKER], more: [] },
  [TS_EVENTS.CHANNEL_PASSWORD_CHANGED]: { main: ['cid'], more: [] },
  [TS_EVENTS.TEXT_MESSAGE]: { main: ['msg', 'targetmode', ...INVOKER], more: [] },
  [TS_EVENTS.TOKEN_USED]: null,
};
