// Which `servernotifyregister` category delivers which `notify...` line. The
// ServerQuery manual lists the categories but not what each one sends, so this
// table was measured: one listener per category on a TeamSpeak 6.0.0-beta13.1
// server, then every kind of event provoked (clients joining, leaving and being
// moved, channels created, edited, moved and deleted, the server edited, chat
// in the server, a channel and privately, a ban added and removed).
//
// Two things in it are not obvious:
//  - client joins and leaves come with `server` *and* with `channel`, and a
//    listener registered for both still gets each one once;
//  - `notifytextmessage` belongs to a category by its `targetmode`.

import type { ConsoleEventCategory } from '../types/console.js';

const BY_NAME: Readonly<Record<string, readonly ConsoleEventCategory[]>> = {
  notifycliententerview: ['server', 'channel'],
  notifyclientleftview: ['server', 'channel'],
  notifyserveredited: ['server'],
  notifyclientmoved: ['channel'],
  notifychannelcreated: ['channel'],
  notifychanneledited: ['channel'],
  notifychanneldescriptionchanged: ['channel'],
  notifychannelpasswordchanged: ['channel'],
  notifychannelmoved: ['channel'],
  notifychanneldeleted: ['channel'],
  notifybanupdate: ['bans'],
};

/** `targetmode` of a text message: 1 is private, 2 the channel, 3 the whole server. */
const TEXT_MESSAGE_CATEGORY: Readonly<Record<string, ConsoleEventCategory>> = {
  '1': 'textprivate',
  '2': 'textchannel',
  '3': 'textserver',
};

/**
 * The categories that deliver an event. Empty for one that is not in the
 * table - a newer TeamSpeak may send more than this app has measured - which
 * the listener then hands to everyone, rather than dropping what nobody has
 * classified.
 */
export function categoriesOfEvent(name: string, data: Readonly<Record<string, string>>): ConsoleEventCategory[] {
  if (name === 'notifytextmessage') {
    const category = TEXT_MESSAGE_CATEGORY[data.targetmode ?? ''];
    return category ? [category] : [];
  }
  // Not Object.hasOwn: this file is also compiled by the frontend, whose lib stops at ES2020.
  return Object.prototype.hasOwnProperty.call(BY_NAME, name) ? [...BY_NAME[name]] : [];
}
