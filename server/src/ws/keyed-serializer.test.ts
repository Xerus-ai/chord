import { describe, expect, it } from 'vitest';
import { createKeyedSerializer } from './keyed-serializer.js';

/**
 * Presence updates for one (user, work item) must take effect in the order
 * they were sent: a quick "nothing focused" then "in the chat" once committed
 * the older row last (devstation-5ek). The serializer runs one task per key at
 * a time, in call order, however long each takes.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createKeyedSerializer', () => {
  it('runs tasks for one key in call order, even when an earlier one is slower', async () => {
    const run = createKeyedSerializer();
    const done: string[] = [];
    await Promise.all([
      run('u1:w1', async () => {
        await sleep(30);
        done.push('first');
      }),
      run('u1:w1', async () => {
        done.push('second');
      }),
    ]);
    expect(done).toEqual(['first', 'second']);
  });

  it('lets different keys run side by side', async () => {
    const run = createKeyedSerializer();
    const done: string[] = [];
    await Promise.all([
      run('u1:w1', async () => {
        await sleep(30);
        done.push('slow w1');
      }),
      run('u1:w2', async () => {
        done.push('quick w2');
      }),
    ]);
    expect(done).toEqual(['quick w2', 'slow w1']);
  });

  it('goes on after a failed task, and hands the failure to its caller', async () => {
    const run = createKeyedSerializer();
    const failed = run('u1:w1', async () => {
      throw new Error('write failed');
    });
    const next = run('u1:w1', async () => 'written');
    await expect(failed).rejects.toThrow('write failed');
    await expect(next).resolves.toBe('written');
  });
});
