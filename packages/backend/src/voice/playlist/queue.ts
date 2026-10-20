import { EventEmitter } from "events";

export type RepeatMode = "off" | "track";

export interface QueueItem {
  id: string;
  title: string;
  artist?: string;
  duration?: number; // seconds
  filePath: string;
  source: "local" | "youtube" | "url" | "radio";
  sourceUrl?: string;
  streamUrl?: string; // If set, play as live stream (radio) instead of file
}

/** How many finished tracks previous() can step back through. */
const HISTORY_LIMIT = 50;

/** The tracks still to play. The current track, if there is one, is always
 * items[0]; once it is done (next(), or another track started via
 * insertNext()/playNow()) it leaves the queue for a hidden history that only
 * previous() reads, so the queue never fills up with played tracks.
 *
 * Emits 'lengthChange' whenever the queue's length actually changes (not on
 * move/shuffle/repeat, which don't) - lets callers (e.g. a description-
 * template's {queue_length}) react without polling. */
export class PlayQueue extends EventEmitter {
  private items: QueueItem[] = [];
  private hasCurrent = false;
  private history: QueueItem[] = [];
  private _shuffle = false;
  private _repeat: RepeatMode = "off";
  // Insertion order, so turning shuffle off can restore it
  private seq = new WeakMap<QueueItem, number>();
  private nextSeq = 0;

  get current(): QueueItem | null {
    return this.hasCurrent ? this.items[0] : null;
  }

  get length(): number {
    return this.items.length;
  }

  /** Position of the current track: 0, or -1 when nothing is current. */
  get index(): number {
    return this.hasCurrent ? 0 : -1;
  }

  get repeat(): RepeatMode {
    return this._repeat;
  }

  get shuffle(): boolean {
    return this._shuffle;
  }

  getAll(): QueueItem[] {
    return [...this.items];
  }

  private get firstUpcoming(): number {
    return this.hasCurrent ? 1 : 0;
  }

  private changed(): void {
    this.emit("lengthChange", this.items.length);
  }

  private addOne(item: QueueItem): void {
    this.seq.set(item, this.nextSeq++);
    if (this._shuffle) {
      // Random spot among the upcoming tracks, never ahead of the current one
      const start = this.firstUpcoming;
      const pos = start + Math.floor(Math.random() * (this.items.length - start + 1));
      this.items.splice(pos, 0, item);
    } else {
      this.items.push(item);
    }
  }

  add(item: QueueItem): void {
    this.addOne(item);
    this.changed();
  }

  addMany(items: QueueItem[]): void {
    if (items.length === 0) return;
    for (const item of items) {
      this.addOne(item);
    }
    this.changed();
  }

  /** The current track is done: move it into the history. */
  private retireCurrent(): void {
    if (!this.hasCurrent) return;
    this.history.push(this.items.shift()!);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.hasCurrent = false;
  }

  /** Make `item` the current track - for "play this now" call sites. The
   * track that was current counts as played; everything queued stays queued
   * behind the new one. */
  insertNext(item: QueueItem): void {
    this.retireCurrent();
    this.seq.set(item, this.nextSeq++);
    this.items.unshift(item);
    this.hasCurrent = true;
    this.changed();
  }

  /** Make the track at `index` current right away, pulling it to the front.
   * The tracks that were ahead of it stay queued instead of being skipped;
   * the one that was current counts as played. */
  playNow(index: number): QueueItem | null {
    if (index < 0 || index >= this.items.length) return null;
    if (index === 0 && this.hasCurrent) return this.current;
    const [item] = this.items.splice(index, 1);
    this.retireCurrent();
    this.items.unshift(item);
    this.hasCurrent = true;
    this.changed();
    return item;
  }

  removeAt(index: number): QueueItem | null {
    if (index < 0 || index >= this.items.length) return null;
    const [item] = this.items.splice(index, 1);
    // A removed current track keeps playing; when it ends, next() starts the
    // first one left instead of treating that one as already played.
    if (index === 0) this.hasCurrent = false;
    this.changed();
    return item;
  }

  clear(): void {
    const hadItems = this.items.length > 0;
    this.items = [];
    this.history = [];
    this.hasCurrent = false;
    if (hadItems) this.changed();
  }

  /** The current track has finished (or is skipped): drop it and make the
   * next one current. Track repeat is handled by VoiceBot directly. */
  next(): QueueItem | null {
    const before = this.items.length;
    this.retireCurrent();
    this.hasCurrent = this.items.length > 0;
    if (this.items.length !== before) this.changed();
    return this.current;
  }

  /** Step back: the last finished track becomes current again and the one
   * that was current is next. Without history the current track restarts. */
  previous(): QueueItem | null {
    const prev = this.history.pop();
    if (!prev) return this.current;
    this.items.unshift(prev);
    this.hasCurrent = true;
    this.changed();
    return prev;
  }

  /** Reorder the upcoming tracks; the current track stays first. */
  move(fromIndex: number, toIndex: number): boolean {
    const start = this.firstUpcoming;
    if (fromIndex < start || fromIndex >= this.items.length) return false;
    if (toIndex < start || toIndex >= this.items.length) return false;
    if (fromIndex === toIndex) return true;

    const [item] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, item);
    return true;
  }

  setRepeat(mode: RepeatMode): void {
    this._repeat = mode;
  }

  /** Shuffles the upcoming tracks (again, if already on); turning it off puts
   * them back in the order they were added. */
  setShuffle(enabled: boolean): void {
    this._shuffle = enabled;
    const start = this.firstUpcoming;
    const upcoming = this.items.slice(start);
    if (enabled) {
      // Fisher-Yates shuffle
      for (let i = upcoming.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
      }
    } else {
      upcoming.sort((a, b) => (this.seq.get(a) ?? 0) - (this.seq.get(b) ?? 0));
    }
    this.items.splice(start, upcoming.length, ...upcoming);
  }
}
