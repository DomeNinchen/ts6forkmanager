// Renders a user-defined client_description template for a music bot, with
// placeholders filled in from the currently playing track. See README for
// the full placeholder reference shown to users.

export interface DescriptionContext {
  title: string;
  artist?: string | null;
  position: number; // seconds elapsed
  duration: number; // seconds total, 0 = unknown/live (e.g. radio stream)
  queueRemaining: number; // songs still queued after the current one
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.max(0, Math.round(totalSeconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export function renderDescriptionTemplate(template: string, ctx: DescriptionContext): string {
  const known = ctx.duration > 0;
  const remainingSec = known ? Math.max(0, ctx.duration - ctx.position) : 0;

  const replacements: Record<string, string> = {
    title: ctx.title,
    artist: ctx.artist || '',
    remaining: known ? formatDuration(remainingSec) : '',
    remaining_min: known ? String(Math.max(0, Math.round(remainingSec / 60))) : '',
    elapsed: formatDuration(ctx.position),
    duration: known ? formatDuration(ctx.duration) : '',
    queue_length: String(Math.max(0, ctx.queueRemaining)),
  };

  return template.replace(/\{(\w+)\}/g, (match, key) => replacements[key] ?? match);
}

/** Shown in the frontend as a cheat-sheet next to the template field. */
export const DESCRIPTION_PLACEHOLDERS: Array<{ key: string; description: string }> = [
  { key: 'title', description: 'Title of the currently playing track' },
  { key: 'artist', description: 'Artist, if known (empty string otherwise)' },
  { key: 'remaining', description: 'Time left, auto-formatted ("42 min" or "1h 5min" past 60 min); empty for live streams' },
  { key: 'remaining_min', description: 'Time left in plain minutes (whole number); empty for live streams' },
  { key: 'elapsed', description: 'Time played so far, formatted the same way as {remaining}' },
  { key: 'duration', description: 'Total track length, formatted the same way; empty for live streams' },
  { key: 'queue_length', description: 'Number of songs still queued after this one' },
];
