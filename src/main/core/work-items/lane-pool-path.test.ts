import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLanePoolPath } from './lane-pool-path';

/** Where a repository's checkouts go: its own folder if the user chose one, else one under the worktree root. */
describe('resolveLanePoolPath', () => {
  const worktreeRoot = path.resolve('/home/me/chord/worktrees');

  it("puts checkouts in the repository's folder under the worktree root", () => {
    expect(
      resolveLanePoolPath({ worktreeRoot, repoLabel: 'app', repoId: 'r1', justMeFolder: undefined })
    ).toBe(path.join(worktreeRoot, 'app'));
  });

  it("uses the repository's own folder, as is, when the user set one", () => {
    const folder = path.resolve('/fast-disk/app-lanes');
    expect(
      resolveLanePoolPath({ worktreeRoot, repoLabel: 'app', repoId: 'r1', justMeFolder: folder })
    ).toBe(folder);
  });

  it('makes the label safe as a folder name', () => {
    expect(
      resolveLanePoolPath({
        worktreeRoot,
        repoLabel: 'a/b:c',
        repoId: 'r1',
        justMeFolder: undefined,
      })
    ).not.toMatch(/a[\\/]b/);
  });
});
