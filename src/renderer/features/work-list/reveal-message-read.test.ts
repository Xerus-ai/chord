import { describe, expect, it } from 'vitest';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import {
  readRevealMessage,
  revealReadOutcomeOf,
  type RevealMessageRow,
} from './reveal-message-read';

const ROW: RevealMessageRow = { id: 'm1', sessionId: 's1', createdAt: '2026-10-01T10:00:00.000Z' };

/**
 * What a click on a chat notification learns from reading its message
 * (shared-items step 5, decisions 1 and 4).
 */
describe('revealReadOutcomeOf', () => {
  it('a 404 is a message that is not there', () => {
    expect(revealReadOutcomeOf(new CloudApiError(404, 'Message not found'))).toEqual({
      kind: 'gone',
    });
  });

  it('a 403 is a chat this viewer cannot see (an artifact-only share)', () => {
    expect(
      revealReadOutcomeOf(new CloudApiError(403, 'Only the artifacts', 'ARTIFACTS_ONLY'))
    ).toEqual({ kind: 'hidden' });
  });

  it('anything else is a failure, named', () => {
    expect(revealReadOutcomeOf(new CloudApiError(500, 'boom'))).toEqual({
      kind: 'failed',
      message: 'boom',
    });
    expect(revealReadOutcomeOf(new TypeError('Failed to fetch'))).toEqual({
      kind: 'failed',
      message: 'Failed to fetch',
    });
  });
});

/**
 * The owner reads its own copy first (teammate rows are ingested locally); the
 * cloud only when the row is not local. A cloud 404 is retried for a short,
 * bounded window: the owner's own row reaches the cloud a moment after the
 * mention that names it.
 */
describe('readRevealMessage', () => {
  const noWait = () => Promise.resolve();

  it('takes the local row without asking the cloud', async () => {
    const asked: string[] = [];
    const outcome = await readRevealMessage({
      readLocal: () => Promise.resolve(ROW),
      readCloud: () => {
        asked.push('cloud');
        return Promise.resolve(ROW);
      },
      wait: noWait,
    });
    expect(outcome).toEqual({ kind: 'found', message: ROW });
    expect(asked).toEqual([]);
  });

  it('reads the cloud when there is no local copy (a teammate has none)', async () => {
    const outcome = await readRevealMessage({
      readLocal: null,
      readCloud: () => Promise.resolve(ROW),
      wait: noWait,
    });
    expect(outcome).toEqual({ kind: 'found', message: ROW });
  });

  it('waits out a 404 that the sync push answers on a later try', async () => {
    let tries = 0;
    const outcome = await readRevealMessage({
      readLocal: () => Promise.resolve(null),
      readCloud: () => {
        tries += 1;
        return tries < 3
          ? Promise.reject(new CloudApiError(404, 'Message not found'))
          : Promise.resolve(ROW);
      },
      wait: noWait,
    });
    expect(outcome).toEqual({ kind: 'found', message: ROW });
    expect(tries).toBe(3);
  });

  it('a 404 that outlasts the window is gone, after three tries', async () => {
    let tries = 0;
    const outcome = await readRevealMessage({
      readLocal: null,
      readCloud: () => {
        tries += 1;
        return Promise.reject(new CloudApiError(404, 'Message not found'));
      },
      wait: noWait,
    });
    expect(outcome).toEqual({ kind: 'gone' });
    expect(tries).toBe(3);
  });

  it('a 403 is answered at once, not retried', async () => {
    let tries = 0;
    const outcome = await readRevealMessage({
      readLocal: null,
      readCloud: () => {
        tries += 1;
        return Promise.reject(new CloudApiError(403, 'no', 'ARTIFACTS_ONLY'));
      },
      wait: noWait,
    });
    expect(outcome).toEqual({ kind: 'hidden' });
    expect(tries).toBe(1);
  });
});
