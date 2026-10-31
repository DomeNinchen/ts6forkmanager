import type { Request, Response } from 'express';
import { BULK_MAX, type BulkOutcome, type BulkResult, type BulkSkipReason } from '@ts6/common';
import { AppError } from '../middleware/error-handler.js';
import { targetIds } from './protected-groups.js';

/**
 * Bulk actions (R9) run one TeamSpeak call per target. A list-form command cannot say which
 * targets went through: measured on TS6, clientmove/banclient with one unknown clid do nothing at
 * all, and clientkick kicks the targets before the unknown one and then answers only the error.
 */

/** A few at a time: quick for 500 targets, gentle on a server without the query allowlist. */
const CONCURRENCY = 4;

/** The ids of a bulk request: positive whole numbers, at least one, at most BULK_MAX, each once. */
export function bulkIds(values: unknown, label: string): number[] {
  if (!Array.isArray(values) || values.length === 0) throw new AppError(400, `${label} must be a non-empty array`);
  if (values.length > BULK_MAX) throw new AppError(400, `${label} may hold at most ${BULK_MAX} entries`);
  return [...new Set(targetIds(values, label))];
}

type BulkTarget = { id: number; name: string; reason?: BulkSkipReason };

/** What would happen: a target with a skip reason is skipped, every other one would run. */
export function planned(targets: BulkTarget[]): BulkOutcome[] {
  return targets.map(({ id, name, reason }) => reason ? { id, name, status: 'skipped', reason } : { id, name, status: 'ok' });
}

/** The request only asks what would happen (the preview): same route, same permission and checks, nothing runs. */
export const isDryRun = (req: Request): boolean => req.body?.dryRun === true;

/** Answers a preview. Marked so the change log records nothing: nothing changed. */
export function sendPreview(res: Response, outcomes: BulkOutcome[]): void {
  res.locals.dryRun = true;
  res.json({ outcomes, dryRun: true } satisfies BulkResult);
}

/** Runs `run` once per target that has no skip reason and reports every target's own outcome, in the given order. */
export async function runPerTarget(targets: BulkTarget[], run: (id: number) => Promise<unknown>): Promise<BulkOutcome[]> {
  const outcomes = planned(targets);
  const todo = outcomes.filter((o) => o.status === 'ok');
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const o = todo[next++];
      try {
        await run(o.id);
      } catch (err) {
        o.status = 'failed';
        o.message = err instanceof Error ? err.message : String(err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return outcomes;
}

/** Answers with the outcomes and leaves them for the change log, which keeps one entry for the whole action. */
export function sendBulk(res: Response, outcomes: BulkOutcome[]): void {
  res.locals.bulkOutcomes = outcomes;
  res.json({ outcomes } satisfies BulkResult);
}
