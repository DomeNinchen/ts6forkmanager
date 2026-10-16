/**
 * Whitelist of TS3 WebQuery commands allowed in bot flow "webquery" actions.
 * Destructive commands (serverstop, serverdelete, instanceedit, permissionreset, etc.)
 * are intentionally excluded to prevent abuse.
 */
export const ALLOWED_WEBQUERY_COMMANDS = new Set([
  // Server info (read-only)
  'serverinfo',
  'serverlist',
  'servergrouplist',
  'servergroupsbyclientid',

  // Channel operations
  'channellist',
  'channelinfo',
  'channelfind',
  'channelcreate',
  'channeledit',
  'channeldelete',
  'channelmove',

  // Client operations
  'clientlist',
  'clientinfo',
  'clientfind',
  'clientgetids',
  'clientgetdbidfromuid',
  'clientgetnamefromuid',
  'clientgetnamefromdbid',
  'clientmove',
  'clientkick',
  'clientpoke',
  'clientdblist',
  'clientdbinfo',

  // Messaging
  'sendtextmessage',
  'messageadd',
  'messagelist',
  'messagedel',
  'messageget',

  // Groups
  'servergroupaddclient',
  'servergroupdelclient',
  'servergroupclientlist',
  'channelgrouplist',
  'channelgroupclientlist',
  'setclientchannelgroup',

  // Bans
  'banclient',
  'banlist',
  'bandel',
  'banadd',

  // Tokens: only deleting. A flow that could create or read privilege keys (tokenadd, tokenlist -
  // and their TS6 names privilegekeyadd/privilegekeylist, which were never listed) would hand a
  // bot operator keys to any group, admin included, that only admins may see in the interface.
  'tokendelete',

  // Complaints
  'complainlist',
  'complaindel',
  'complainadd',

  // Logs
  'logview',

  // Misc read-only
  'whoami',
  'version',
  'hostinfo',
  'connectioninfo',
]);
