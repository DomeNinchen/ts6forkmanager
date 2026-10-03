// What the query console needs to know about a ServerQuery command beyond its
// syntax: which ones are destructive enough to demand a confirmation, which ones
// only read, and which parameters carry secrets. Kept next to the parser in
// `common` because the backend enforces these rules and the frontend has to
// explain them - one list, so the two can never disagree.
//
// Sources: the ServerQuery help texts of TeamSpeak 6 (command names, aliases and
// what each command does) and the parameter names in their examples.

/**
 * Why a command asks for confirmation. The frontend turns each reason into a
 * sentence; the value is only ever a key, never user-facing text.
 */
export type DangerReason =
  | 'processStop' // the whole TeamSpeak process, i.e. every virtual server
  | 'serverStop' // one virtual server, all its clients are disconnected
  | 'serverDelete' // one virtual server, for good
  | 'instanceEdit' // instance-wide settings such as the query flood limits
  | 'snapshotDeploy' // replaces the entire configuration of a virtual server
  | 'permReset' // wipes every group and permission, may even delete the server
  | 'massDelete' // all bans / all complaints at once
  | 'dataDelete' // a channel, a client's stored data, a group
  | 'credentialsRevoke' // API keys, query logins, privilege keys
  | 'credentialsReset'; // a query login gets a new password

/**
 * Commands that never run without an explicit confirmation. Aliases are listed
 * under their own names, since that is what gets typed: `tokendelete` is the
 * old name of `privilegekeydelete`.
 */
export const DANGEROUS_COMMANDS: Readonly<Record<string, DangerReason>> = {
  serverprocessstop: 'processStop',
  serverstop: 'serverStop',
  serverdelete: 'serverDelete',
  instanceedit: 'instanceEdit',
  serversnapshotdeploy: 'snapshotDeploy',
  permreset: 'permReset',
  bandelall: 'massDelete',
  complaindelall: 'massDelete',
  channeldelete: 'dataDelete',
  clientdbdelete: 'dataDelete',
  servergroupdel: 'dataDelete',
  channelgroupdel: 'dataDelete',
  apikeydel: 'credentialsRevoke',
  querylogindel: 'credentialsRevoke',
  privilegekeydelete: 'credentialsRevoke',
  tokendelete: 'credentialsRevoke',
  clientsetserverquerylogin: 'credentialsReset',
};

/** The reason a command is dangerous, or null if it runs without confirmation. */
export function getDangerReason(command: string): DangerReason | null {
  // Not Object.hasOwn: this file is also compiled by the frontend, whose lib stops at ES2020.
  return Object.prototype.hasOwnProperty.call(DANGEROUS_COMMANDS, command) ? DANGEROUS_COMMANDS[command] : null;
}

/**
 * Commands that only look at things. Anything not on this list counts as
 * changing something - deliberately the safe way round: a command this app has
 * never heard of is written to the TeamSpeak server log like any other change
 * rather than slipping past it.
 */
const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  'apikeylist',
  'banfind',
  'banlist',
  'bindinglist',
  'channelclientpermlist',
  'channelfind',
  'channelgroupclientlist',
  'channelgrouplist',
  'channelgrouppermlist',
  'channelinfo',
  'channellist',
  'channelpermlist',
  'clientdbfind',
  'clientdbinfo',
  'clientdblist',
  'clientfind',
  'clientgetdbidfromuid',
  'clientgetids',
  'clientgetnamefromdbid',
  'clientgetnamefromuid',
  'clientgetuidfromclid',
  'clientinfo',
  'clientlist',
  'clientpermlist',
  'complainlist',
  'custominfo',
  'customsearch',
  'ftgetfileinfo',
  'ftgetfilelist',
  'ftlist',
  'help',
  'homebaseisset',
  'homebaselist',
  'hostinfo',
  'instanceinfo',
  'logview',
  'messagelist',
  'permfind',
  'permget',
  'permidgetbyname',
  'permissionlist',
  'permoverview',
  'privilegekeylist',
  'queryloginlist',
  'serverrequestconnectioninfo',
  'serveridgetbyport',
  'serverinfo',
  'serverlist',
  'servergroupclientlist',
  'servergrouplist',
  'servergrouppermlist',
  'servergroupsbyclientid',
  'serversnapshotcreate',
  'servertemppasswordlist',
  'tokenlist',
  'version',
  'whoami',
]);

export function isReadOnlyCommand(command: string): boolean {
  return READ_ONLY_COMMANDS.has(command);
}

/**
 * Parameters (on the way in) and result fields (on the way out) whose values
 * are credentials. Compared as whole names, not as substrings: `channel_flag_password`
 * is a harmless 0/1 flag and must stay readable.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'apikey', // apikeyadd
  'client_login_password', // login, queryloginadd, clientsetserverquerylogin
  'password', // serversnapshotcreate / serversnapshotdeploy
  'pw', // servertemppasswordadd / servertemppassworddel
  'pw_clear', // servertemppasswordlist
  'cpw', // channel password
  'tcpw', // channel password of a target channel
  'token', // privilege keys: tokenadd, tokenlist, permreset, servercreate, ...
  'forauthenticationtoken', // permget
  'ftkey', // ftinitupload / ftinitdownload
  'virtualserver_password',
  'channel_password',
]);

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase());
}
