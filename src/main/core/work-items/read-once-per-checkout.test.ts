import { describe, expect, it } from 'vitest';
import { readOncePerCheckout } from './read-once-per-checkout';

/**
 * Work items without a worktree of their own share one checkout: on the perf
 * profile four rows sat on `D:\Kami`, and the sidebar's summaries diffed that
 * checkout four times on every refresh — git spawns that each hold main's
 * thread (2026-10-15). A read depends only on the checkout's path, branch and
 * target, so rows that share them share one read.
 */
const lane = (id: string, path: string, branchName: string | null, targetRef: string | null) => ({
  id,
  path,
  branchName,
  targetRef,
});

describe('readOncePerCheckout', () => {
  it('reads a checkout once for every row that shares its path, branch and target', async () => {
    const reads: string[] = [];
    const rows = [
      lane('a', 'D:/Kami', null, null),
      lane('b', 'D:/Kami', null, null),
      lane('c', 'D:/Kami', null, null),
    ];

    const results = await readOncePerCheckout(rows, async (row) => {
      reads.push(row.id);
      return `stats of ${row.path}`;
    });

    expect(reads).toHaveLength(1);
    expect([...results.entries()]).toEqual([
      ['a', 'stats of D:/Kami'],
      ['b', 'stats of D:/Kami'],
      ['c', 'stats of D:/Kami'],
    ]);
  });

  it('reads separately when the branch or the target differs on the same path', async () => {
    const reads: string[] = [];
    const rows = [
      lane('main', 'D:/repo', null, null),
      lane('feature', 'D:/repo', 'feature', null),
      lane('targeted', 'D:/repo', 'feature', 'origin/main'),
      lane('elsewhere', 'D:/other', null, null),
    ];

    const results = await readOncePerCheckout(rows, async (row) => {
      reads.push(row.id);
      return row.id;
    });

    expect(reads.sort()).toEqual(['elsewhere', 'feature', 'main', 'targeted']);
    expect(results.get('targeted')).toBe('targeted');
  });

  it('fails every row that shares a read that failed', async () => {
    const rows = [lane('a', 'D:/gone', null, null), lane('b', 'D:/gone', null, null)];

    await expect(
      readOncePerCheckout(rows, async () => {
        throw new Error('not a repository');
      })
    ).rejects.toThrow('not a repository');
  });
});
