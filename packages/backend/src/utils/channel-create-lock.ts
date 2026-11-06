import { TSApiError } from '../middleware/error-handler.js';

// TeamSpeak moves the query client that runs channelcreate into the new channel. Until it has moved
// someone in and left again, nothing else on that virtual server may create a channel with the same
// query client, or the second create pulls it out of the first room (a temporary one is then deleted).
// Bot flows and the support queue share this lock, keyed `${configId}:${sid}`.
const locks = new Map<string, Promise<void>>();

/** Serializes channel creation per virtual server; resolves with the release function. */
export async function acquireChannelCreateLock(key: string): Promise<() => void> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = prev.then(() => new Promise<void>((r) => { release = r; }));
  locks.set(key, tail);
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  await prev;
  return release;
}

/** How many virtual servers have a create running or queued (for tests). */
export function channelCreateLockCount(): number {
  return locks.size;
}

/** clientmove that treats 770 "already member of channel" as done. */
export async function clientMoveTolerating770(client: { executePost(sid: number, cmd: string, params: Record<string, unknown>): Promise<any> }, sid: number, clid: string, cid: string): Promise<void> {
  try {
    await client.executePost(sid, 'clientmove', { clid, cid });
  } catch (err) {
    if (!(err instanceof TSApiError && err.code === 770)) throw err;
  }
}
