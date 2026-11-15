/** A bot's vote-skip rule: more than `percent` % of the people in its channel, and at least `minVotes`. */
export interface VoteSkipRule {
  percent: number;
  minVotes: number;
}

export interface VoteTally {
  /** Votes of people who are in the channel right now. */
  votes: number;
  needed: number;
  passed: boolean;
}

/** Votes needed with `people` in the channel: more than `percent` % (never more than everybody), but at least `minVotes`. */
export function votesNeeded(people: number, rule: VoteSkipRule): number {
  const n = Math.max(0, Math.floor(people) || 0);
  const percent = Number.isFinite(rule.percent) ? Math.min(100, Math.max(0, rule.percent)) : 50;
  const minVotes = Math.max(1, Math.floor(rule.minVotes) || 1);
  return Math.max(minVotes, Math.min(n, Math.floor((n * percent) / 100) + 1));
}

/** Counts only the votes of people who are in the channel now - a vote of somebody who left has lapsed. */
export function tallyVotes(people: ReadonlySet<number>, votes: ReadonlySet<number>, rule: VoteSkipRule): VoteTally {
  let count = 0;
  for (const clid of votes) if (people.has(clid)) count++;
  const needed = votesNeeded(people.size, rule);
  return { votes: count, needed, passed: count >= needed };
}
