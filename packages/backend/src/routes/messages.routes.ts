import { Router, Request, Response } from 'express';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { WebQueryClient } from '../ts-client/webquery-client.js';
import { TSApiError } from '../middleware/error-handler.js';
import { requireRole } from '../middleware/rbac.js';

// Admin-only as a whole: the messages are private, and the page that shows them is admin-only too.
export const messageRoutes: Router = Router({ mergeParams: true });
messageRoutes.use(requireRole('admin'));

const getClient = (req: Request) => {
  const pool: ConnectionPool = req.app.locals.connectionPool;
  return pool.getClient(parseInt(String(req.params.configId)));
};
const getSid = (req: Request) => parseInt(String(req.params.sid));

type Row = Record<string, string>;

/** How many sender UIDs one clientgetnamefromuid request names (a UID is 44 characters). */
const NAME_LOOKUP_BATCH = 50;

/** TeamSpeak said no (unknown UID, missing permission, ...) as opposed to the connection itself failing (code -1). */
const isTsRefusal = (err: unknown): boolean => err instanceof TSApiError && err.code > 0;

/**
 * The nicknames the client database holds for some UIDs; a UID it does not know is left out.
 *
 * messagelist and messageget name a message's sender by unique ID only (`cluid`), so the page would
 * have nothing but a 44-character string to show. clientgetnamefromuid needs no permission, but it
 * refuses the whole request (512) as soon as one UID of it is unknown - a sender whose profile was
 * deleted - so a refused batch is repeated one UID at a time and every refusal is just "no name".
 */
async function nicknamesByUid(client: WebQueryClient, sid: number, uids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const collect = (result: unknown) => {
    if (!Array.isArray(result)) return;
    for (const row of result as Row[]) {
      if (row.cluid && row.name) names.set(row.cluid, row.name);
    }
  };

  for (let i = 0; i < uids.length; i += NAME_LOOKUP_BATCH) {
    const batch = uids.slice(i, i + NAME_LOOKUP_BATCH);
    try {
      collect(await client.executeJsonBody(sid, 'clientgetnamefromuid', { cluid: batch }));
    } catch (err) {
      if (!isTsRefusal(err)) throw err;
      for (const uid of batch) {
        try {
          collect(await client.execute(sid, 'clientgetnamefromuid', { cluid: uid }));
        } catch (single) {
          if (!isTsRefusal(single)) throw single;
        }
      }
    }
  }
  return names;
}

/** The message rows as TeamSpeak sent them, each with the sender's nickname (`senderName`) where the client database knows it. */
async function withSenderNames(client: WebQueryClient, sid: number, result: unknown): Promise<unknown> {
  if (!Array.isArray(result) || result.length === 0) return result;
  const list = result as Row[];
  const uids = [...new Set(list.map((m) => m.cluid).filter((uid): uid is string => !!uid))];
  const names = await nicknamesByUid(client, sid, uids);
  return list.map((m) => (names.has(m.cluid) ? { ...m, senderName: names.get(m.cluid) } : m));
}

// messagelist is the inbox of the query account this manager is connected with, not a server-wide list.
messageRoutes.get('/', async (req: Request, res: Response, next) => {
  try {
    const client = getClient(req);
    const sid = getSid(req);
    res.json(await withSenderNames(client, sid, await client.execute(sid, 'messagelist')));
  } catch (err) { next(err); }
});

// messageget carries the text, which messagelist does not, and deliberately leaves flag_read alone.
messageRoutes.get('/:msgid', async (req: Request, res: Response, next) => {
  try {
    const client = getClient(req);
    const sid = getSid(req);
    res.json(await withSenderNames(client, sid, await client.execute(sid, 'messageget', { msgid: String(req.params.msgid) })));
  } catch (err) { next(err); }
});

messageRoutes.post('/', async (req: Request, res: Response, next) => {
  try { res.status(201).json(await getClient(req).execute(getSid(req), 'messageadd', req.body)); } catch (err) { next(err); }
});

messageRoutes.delete('/:msgid', async (req: Request, res: Response, next) => {
  try { res.json(await getClient(req).execute(getSid(req), 'messagedel', { msgid: String(req.params.msgid) })); } catch (err) { next(err); }
});
