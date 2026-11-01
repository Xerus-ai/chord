import { describe, expect, it } from 'vitest';
import { createSerialWriteQueue } from './serial-write-queue';

/**
 * Leaving one work item and opening the next record "viewed" back to back.
 * Each write used to re-read every sidebar summary when it landed — two full
 * sweeps of git across every worktree per click (measured 2026-10-15). The
 * queue runs the writes in order and says which one drained it, so the
 * summaries are re-read once, after the last.
 */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSerialWriteQueue', () => {
  it('runs writes one after another, in the order they were queued', async () => {
    const enqueue = createSerialWriteQueue();
    const order: string[] = [];
    const first = deferred();

    const a = enqueue(async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
    });
    const b = enqueue(async () => {
      order.push('b:start');
    });
    await Promise.resolve();
    expect(order).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('reports drained only for the write that leaves nothing queued behind it', async () => {
    const enqueue = createSerialWriteQueue();

    const results = await Promise.all([enqueue(async () => {}), enqueue(async () => {})]);

    expect(results).toEqual([false, true]);
    expect(await enqueue(async () => {})).toBe(true);
  });

  it('rejects a failed write to its caller and still runs the next one', async () => {
    const enqueue = createSerialWriteQueue();
    let ranAfter = false;

    const failing = enqueue(async () => {
      throw new Error('disk full');
    });
    const next = enqueue(async () => {
      ranAfter = true;
    });

    await expect(failing).rejects.toThrow('disk full');
    expect(await next).toBe(true);
    expect(ranAfter).toBe(true);
  });
});
