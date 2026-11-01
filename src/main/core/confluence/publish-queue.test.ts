import { describe, expect, it } from 'vitest';
import { runPublishExclusively, waitForPublishInFlight } from './publish-queue';

/**
 * A publish updates the page, then records the version it wrote. Between the
 * two, a status read would see the page ahead of the record and call it
 * "Edited in Confluence"; a second publish would refuse for the same reason.
 * Publishes of one artifact therefore run one at a time, and status reads
 * wait for the one in flight.
 */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('publish queue', () => {
  it('runs publishes of one artifact one at a time, in order', async () => {
    const order: string[] = [];
    const gate = deferred();
    const first = runPublishExclusively('a', async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
    });
    const second = runPublishExclusively('a', async () => {
      order.push('second');
    });
    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('does not hold up a publish of another artifact', async () => {
    const gate = deferred();
    const slow = runPublishExclusively('a', () => gate.promise);
    let otherRan = false;
    await runPublishExclusively('b', async () => {
      otherRan = true;
    });
    expect(otherRan).toBe(true);
    gate.resolve();
    await slow;
  });

  it('lets a status read wait for the publish in flight', async () => {
    const gate = deferred();
    let recorded = false;
    const publish = runPublishExclusively('a', async () => {
      await gate.promise;
      recorded = true;
    });
    const read = waitForPublishInFlight('a').then(() => recorded);
    gate.resolve();
    expect(await read).toBe(true);
    await publish;
  });

  it('reports a failed publish to its caller and still runs the next one', async () => {
    const failing = runPublishExclusively('a', async () => {
      throw new Error('Confluence said no');
    });
    const next = runPublishExclusively('a', async () => 'ran');
    await expect(failing).rejects.toThrow('Confluence said no');
    await expect(next).resolves.toBe('ran');
    await expect(waitForPublishInFlight('a')).resolves.toBeUndefined();
  });
});
