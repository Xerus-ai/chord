/**
 * Serializes concurrent sends per key so two callers racing on the same
 * key (a work item, or an explicit session) don't both slip past an
 * in-memory check and start two agent processes for one conversation.
 *
 * Two independent runners are exported: one keyed by work item id (the
 * "no active session → start one" race for the default send path) and one
 * keyed by session id (the "resume this specific suspended session" race
 * for the explicit-session send path). They must stay separate — locking
 * per work item would serialize sends to two different sessions on the same
 * work item, which is exactly the concurrency multi-session sending exists
 * to allow.
 */
function makeExclusiveRunner(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const locks = new Map<string, Promise<unknown>>();
  return function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const guard = run.then(
      () => {},
      () => {}
    );
    locks.set(key, guard);
    void guard.finally(() => {
      if (locks.get(key) === guard) locks.delete(key);
    });
    return run;
  };
}

export const runExclusivePerWorkItem = makeExclusiveRunner();
export const runExclusivePerSession = makeExclusiveRunner();
