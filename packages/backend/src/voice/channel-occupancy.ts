import type { ParsedCommand } from './tslib/index.js';

/** `client_type` as TeamSpeak reports it: 0 for a client with a voice connection (a person or a bot), 1 for a ServerQuery client. */
const CLIENT_TYPE_VOICE = 0;

interface KnownClient {
  cid: number;
  type: number;
}

/**
 * Who is in a bot's own channel, built from what the bot's voice connection is
 * told by the server (`notifycliententerview`, `notifyclientleftview`,
 * `notifyclientmoved`) - no WebQuery needed, so it works on a server connection
 * that has no API key too.
 *
 * Measured on TeamSpeak 6.0.0-beta13.1 with a plain voice client:
 *  - right after connecting the server lists the clients it shows us in one
 *    piped `notifycliententerview` (our own entry included) - only those of
 *    the channel we are in, clients of other channels are not in it. Entries
 *    after the first leave out keys that equal the first entry's value (`ctid`
 *    most visibly), see {@link expandEntries}. All entries sharing one channel,
 *    "same as the first" and "same as the previous" read alike here.
 *  - a client that moves into another channel is announced as `clientleftview`
 *    (with `ctid` = where it went) when we cannot see that channel, as
 *    `clientmoved` when we can.
 *  - when WE are moved, the server first announces the clients of the new
 *    channel (`cliententerview`) and only then sends `clientmoved` for our own
 *    clid. So nothing may be cleared on our own move: what arrived just before
 *    it is exactly the new channel's occupants. The model therefore keeps
 *    every client we have been told about together with its channel, and the
 *    occupants are whoever's channel is ours - a move of ours just changes
 *    which channel that is.
 *  - what a client is told about is not forgotten when it leaves a channel
 *    (a client we moved away from keeps being reported), which is another
 *    reason to track channels per client rather than as a list for "the" channel.
 */
export class ChannelOccupancy {
  private known = new Map<number, KnownClient>();
  private ownChannel = 0;

  /** The channel the bot is in; 0 until the server has said. */
  get currentChannelId(): number {
    return this.ownChannel;
  }

  reset(): void {
    this.known.clear();
    this.ownChannel = 0;
  }

  /**
   * Feeds one command from the voice connection. Returns true when it was one
   * of the three this class reads (whether or not the answer to "who is here"
   * changed - callers re-check cheaply).
   */
  handle(cmd: ParsedCommand, ownClid: number): boolean {
    switch (cmd.name) {
      case 'notifycliententerview':
        for (const e of expandEntries(cmd)) {
          const clid = parseInt(e.clid);
          const cid = parseInt(e.ctid);
          if (!clid || isNaN(cid)) continue;
          this.known.set(clid, { cid, type: parseInt(e.client_type ?? '0') || 0 });
          if (clid === ownClid) this.ownChannel = cid;
        }
        return true;

      case 'notifyclientleftview':
        for (const e of expandEntries(cmd)) {
          const clid = parseInt(e.clid);
          if (clid) this.known.delete(clid);
        }
        return true;

      case 'notifyclientmoved':
        for (const e of expandEntries(cmd)) {
          const clid = parseInt(e.clid);
          const cid = parseInt(e.ctid);
          if (!clid || isNaN(cid)) continue;
          const client = this.known.get(clid);
          if (client) client.cid = cid;
          if (clid === ownClid) this.ownChannel = cid;
        }
        return true;

      default:
        return false;
    }
  }

  /**
   * People in the bot's channel: voice clients other than the bot itself and
   * other than `excluded` (the app's other bots, which are voice clients too).
   * null while the bot's own channel is not known yet - "nobody" would be a
   * claim about an empty channel the bot has no basis for.
   */
  countPeople(ownClid: number, excluded?: ReadonlySet<number>): number | null {
    if (!this.ownChannel || !ownClid) return null;
    let n = 0;
    for (const [clid, c] of this.known) {
      if (clid === ownClid || excluded?.has(clid)) continue;
      if (c.cid === this.ownChannel && c.type === CLIENT_TYPE_VOICE) n++;
    }
    return n;
  }
}

/**
 * The entries of a command that may carry several, piped. Within such a list
 * the first entry is complete and the others only state what differs from it.
 */
function expandEntries(cmd: ParsedCommand): Record<string, string>[] {
  const entries = cmd.groups ?? [cmd.params];
  if (entries.length < 2) return entries;
  const first = entries[0];
  return entries.map((e, i) => (i === 0 ? e : { ...first, ...e }));
}
