/**
 * Runs async writes one after another in the order they are queued. Each
 * call resolves `true` when its write drained the queue (nothing was queued
 * behind it), so work that should follow a burst of writes — re-reading what
 * they changed — runs once, after the last. A failed write rejects to its own
 * caller and does not stop the writes queued after it.
 */
export function createSerialWriteQueue(): (write: () => Promise<void>) => Promise<boolean> {
  let chain: Promise<void> = Promise.resolve();
  let queued = 0;
  return async (write) => {
    queued += 1;
    const run = chain.then(write);
    // The next write waits for this one to settle, whichever way; this one's
    // failure is its caller's, through `run`.
    chain = run.then(
      () => undefined,
      () => undefined
    );
    try {
      await run;
    } finally {
      queued -= 1;
    }
    return queued === 0;
  };
}
