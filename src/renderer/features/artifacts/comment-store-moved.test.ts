import { describe, expect, it } from 'vitest';
import type { CommentStore } from './artifact-comments-store';
import { CommentStoreMovedError, runOnCommentStore } from './comment-store-moved';

/**
 * A comments card resolves its store once and keeps it (use-comments.ts). An
 * artifact that syncs while the card is open moves its comments to the cloud
 * (devstation-85y), and the device store then refuses it. The card forgets the
 * store it held, resolves again, and runs the same read or write there — once.
 */
function storeThatSyncs() {
  let current: CommentStore = 'local';
  let resolved: CommentStore | null = null;
  let resolutions = 0;
  return {
    sync: () => {
      current = 'cloud';
    },
    resolutions: () => resolutions,
    access: {
      getStore: async () => {
        if (resolved) return resolved;
        resolutions += 1;
        resolved = current;
        return resolved;
      },
      forgetStore: () => {
        resolved = null;
      },
    },
  };
}

describe('runOnCommentStore', () => {
  it('runs on the held store while it still answers', async () => {
    const store = storeThatSyncs();
    const ran: CommentStore[] = [];

    const result = await runOnCommentStore(store.access, async (s) => {
      ran.push(s);
      return 'listed';
    });

    expect(result).toBe('listed');
    expect(ran).toEqual(['local']);
  });

  it('re-resolves and runs once more on the cloud when the device store says the artifact moved', async () => {
    const store = storeThatSyncs();
    await store.access.getStore();
    store.sync();
    const ran: CommentStore[] = [];

    const result = await runOnCommentStore(store.access, async (s) => {
      ran.push(s);
      if (s === 'local') throw new CommentStoreMovedError();
      return 'created in the cloud';
    });

    expect(result).toBe('created in the cloud');
    expect(ran).toEqual(['local', 'cloud']);
    expect(store.resolutions()).toBe(2);
    expect(await store.access.getStore()).toBe('cloud');
  });

  it('does not retry any other failure', async () => {
    const store = storeThatSyncs();
    let calls = 0;

    await expect(
      runOnCommentStore(store.access, async () => {
        calls += 1;
        throw new Error('network down');
      })
    ).rejects.toThrow('network down');
    expect(calls).toBe(1);
  });

  it('gives up after one retry rather than looping', async () => {
    const store = storeThatSyncs();
    let calls = 0;

    await expect(
      runOnCommentStore(store.access, async () => {
        calls += 1;
        throw new CommentStoreMovedError();
      })
    ).rejects.toBeInstanceOf(CommentStoreMovedError);
    expect(calls).toBe(2);
  });
});
