import { resolve } from 'node:path';

/**
 * Git takes an exclusive `.git/index.lock` for the whole of any command that
 * writes the index. Chord runs several such commands against the same checkout
 * from independent triggers — a checkpoint revert, a commit, a per-file stage
 * or discard — so two of them overlapping makes the loser die with
 * "Unable to create '.../index.lock': File exists".
 *
 * Every index-mutating operation on a repo therefore goes through one promise
 * chain per repo path. Read-only git commands stay off the chain; so does the
 * network half of a push, which must not hold the lock for its whole duration.
 */
const repoQueues = new Map<string, Promise<unknown>>();

export function enqueueRepoIndexOp<T>(repoPath: string, run: () => Promise<T>): Promise<T> {
  // Windows paths are case-insensitive: two differently-cased spellings of
  // the same repo must share one queue, or they never serialize and produce
  // the exact index.lock collision this queue exists to prevent.
  const resolved = resolve(repoPath);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const tail = repoQueues.get(key) ?? Promise.resolve();

  // `then(run, run)` so a rejected predecessor still releases the chain.
  const result = tail.then(run, run);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  repoQueues.set(key, settled);

  void settled.then(() => {
    // Drop the entry once this op is the last one queued, so the map tracks
    // active repos rather than every repo the app has ever touched.
    if (repoQueues.get(key) === settled) repoQueues.delete(key);
  });

  return result;
}
