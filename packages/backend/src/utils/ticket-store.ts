import { randomBytes } from 'crypto';

/** What a redeemable token looks like: 32 random bytes, base64url-encoded. */
export const TICKET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Short-lived, single-use tickets held in memory. An unguessable token maps to
 * whatever the issuer wants remembered until somebody presents it; presenting
 * it removes it, so a token works exactly once, and one that is never presented
 * simply expires.
 *
 * Nothing is persisted on purpose: a ticket lives for seconds, so a restart
 * costing the tickets that were outstanding at that moment is no loss at all.
 */
export class TicketStore<T> {
  private readonly tickets = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxTickets = 1000,
  ) {}

  issue(value: T): string {
    this.sweep();
    // Only admins can issue tickets, so this is a backstop rather than a defence
    // against abuse: never let the map grow without bound. A Map iterates in
    // insertion order, so the first key is the oldest ticket.
    if (this.tickets.size >= this.maxTickets) {
      const oldest = this.tickets.keys().next().value;
      if (oldest !== undefined) this.tickets.delete(oldest);
    }
    const token = randomBytes(32).toString('base64url');
    this.tickets.set(token, { value, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  /** Look a ticket up without using it up; undefined when the token is unknown,
   * already used or expired. */
  peek(token: string): T | undefined {
    if (!TICKET_TOKEN_PATTERN.test(token)) return undefined;
    const entry = this.tickets.get(token);
    return entry && entry.expiresAt >= Date.now() ? entry.value : undefined;
  }

  /** Redeem a ticket. Returns what was stored and removes it; undefined when the
   * token is unknown, already used or expired. */
  take(token: string): T | undefined {
    if (!TICKET_TOKEN_PATTERN.test(token)) return undefined;
    const entry = this.tickets.get(token);
    if (!entry) return undefined;
    this.tickets.delete(token);
    return entry.expiresAt >= Date.now() ? entry.value : undefined;
  }

  /** Remove a ticket whatever its age and hand back what was stored - undefined
   * when it was already redeemed. Lets the issuer clean up after a ticket that
   * nobody ever redeemed. */
  drop(token: string): T | undefined {
    const entry = this.tickets.get(token);
    if (!entry) return undefined;
    this.tickets.delete(token);
    return entry.value;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.tickets) {
      if (entry.expiresAt < now) this.tickets.delete(token);
    }
  }
}
