import type { BulkOutcome } from '../types/bulk.js';
import type { ClientDbBanOutcome, ClientDbDeleteResult } from '../types/client-database.js';

// The client database answers in its own, older shapes; these turn them into bulk outcomes (R9) for
// the result dialog and the change log.

/** One line per profile and ban target (a profile banned by identity and by IP has two). */
export function clientDbBanToBulk(outcomes: ClientDbBanOutcome[]): BulkOutcome[] {
  return outcomes.map((o): BulkOutcome => ({
    id: o.cldbid,
    name: `${o.nickname || `#${o.cldbid}`} (${o.target})`,
    ...(o.status === 'created' ? { status: 'ok' as const }
      : o.status === 'skipped' ? { status: 'skipped' as const, reason: o.message === 'not-found' ? 'not-found' as const : 'no-value' as const }
      : { status: 'failed' as const, message: o.message }),
  }));
}

export function clientDbDeleteToBulk(result: ClientDbDeleteResult, name: (cldbid: number) => string = (id) => `#${id}`): BulkOutcome[] {
  return [
    ...result.deleted.map((id): BulkOutcome => ({ id, name: name(id), status: 'ok' })),
    ...result.online.map((id): BulkOutcome => ({ id, name: name(id), status: 'skipped', reason: 'online' })),
    ...result.failed.map((f): BulkOutcome => ({ id: f.cldbid, name: name(f.cldbid), status: 'failed', message: f.message })),
  ];
}
