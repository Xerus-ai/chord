/**
 * Runs tasks one at a time per key, in call order, however long each takes;
 * different keys run side by side. A failed task goes to its caller and the
 * next task still runs. A key's chain is dropped once it drains.
 *
 * For state where the last write must win, like a presence row: two quick
 * updates for one (user, work item) otherwise race, and the older one can
 * land last (devstation-5ek).
 */
export function createKeyedSerializer() {
  const tails = new Map<string, Promise<unknown>>();
  return function runInOrder<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
