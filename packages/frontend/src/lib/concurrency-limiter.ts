// A minimal counting semaphore for capping how many async tasks run at once.
// Built for icon image loading (see IconImage.tsx): a real TeamSpeak 6 server
// only accepts a small, fixed number of concurrent pending `ftinitdownload`
// tickets before answering with "file transfer limit reached" - confirmed
// live against a real server (~10 slots, undocumented, no ServerQuery setting
// controls it). An icon grid can easily have more thumbnails than that on
// screen at once, so fetches are queued through a limiter instead of firing
// unbounded in parallel.
export function createConcurrencyLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  function next() {
    if (active >= maxConcurrent || queue.length === 0) return;
    active++;
    const run = queue.shift()!;
    run();
  }

  return async function withLimit<T>(task: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve);
      next();
    });
    try {
      return await task();
    } finally {
      active--;
      next();
    }
  };
}
