import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  addWorktree,
  claudeWorktreePath,
  createScratchRepo,
  git,
  type ScratchRepo,
} from './_testing/scratch-worktrees';
import { discoverRepoWorktrees } from './discover-repo-worktrees';

/**
 * Which checkouts of a repository Chord did not make (plan §Phase 3 slice 6,
 * Discovery): `git worktree list --porcelain` in the registered clone, minus
 * the main checkout and every path a lane already holds, compared with
 * `comparablePath`. Real repositories, real worktrees, the real schema.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const REPO_ID = 'repo-1';
const ITEM_ID = 'item-1';

let scratch: ScratchRepo;
let claudeX: string;
let side: string;
let detached: string;
let laneA: string;

/** The fields discovery is about, sorted by path so the order git lists them in doesn't matter. */
async function discover() {
  return (await discoverRepoWorktrees(REPO_ID))
    .map(({ path: folder, branch, source }) => ({ path: folder, branch, source }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

beforeAll(() => {
  scratch = createScratchRepo('chord-discover-');
  claudeX = addWorktree(scratch.repo, claudeWorktreePath(scratch.repo, 'x'), 'claude/x');
  side = addWorktree(scratch.repo, path.join(scratch.root, 'elsewhere', 'side'), 'feature/side');
  detached = addWorktree(scratch.repo, path.join(scratch.root, 'elsewhere', 'detached'), null);
  laneA = addWorktree(scratch.repo, path.join(scratch.root, 'pool', 'lane-a'), 'chord/lane-a');
});

afterAll(() => {
  removeDirSync(scratch.root);
});

beforeEach(() => {
  db.delete(workItems).run();
  db.delete(repos).run();
  db.insert(repos).values({ id: REPO_ID, path: scratch.repo, alias: 'repo' }).run();
  db.insert(workItems)
    .values({ id: ITEM_ID, name: 'lane a', repoId: REPO_ID, repoPath: laneA })
    .run();
});

function holdWithLane(id: string, folder: string, branchName: string | null) {
  db.insert(workItemWorktrees)
    .values({
      id,
      workItemId: ITEM_ID,
      path: folder,
      branchName,
      isPrimary: id === 'lane-a' ? 1 : 0,
    })
    .run();
}

describe('discoverRepoWorktrees', () => {
  it('lists every linked worktree but the main checkout, each with its branch and source', async () => {
    expect(await discover()).toEqual(
      [
        { path: path.resolve(claudeX), branch: 'claude/x', source: 'claudeCode' },
        { path: path.resolve(side), branch: 'feature/side', source: 'other' },
        // Listed so the user sees it; Adopt refuses it as no_branch.
        { path: path.resolve(detached), branch: null, source: 'other' },
        { path: path.resolve(laneA), branch: 'chord/lane-a', source: 'other' },
      ].sort((a, b) => a.path.localeCompare(b.path))
    );
  });

  it('leaves out a checkout a lane already holds', async () => {
    holdWithLane('lane-a', laneA, 'chord/lane-a');

    const found = (await discover()).map((w) => w.path);

    expect(found).not.toContain(path.resolve(laneA));
    expect(found).toContain(path.resolve(claudeX));
  });

  it.runIf(process.platform === 'win32')(
    'leaves out a held checkout whose stored path is spelled in another case',
    async () => {
      holdWithLane('lane-a', laneA.toUpperCase(), 'chord/lane-a');

      expect((await discover()).map((w) => w.path)).not.toContain(path.resolve(laneA));
    }
  );

  it('hides nothing for a lane still being created, which points at the repository itself', async () => {
    holdWithLane('lane-a', laneA, 'chord/lane-a');
    holdWithLane('lane-provisioning', scratch.repo, 'chord/new-item');

    const found = (await discover()).map((w) => w.path);

    expect(found).toEqual(
      [path.resolve(claudeX), path.resolve(side), path.resolve(detached)].sort((a, b) =>
        a.localeCompare(b)
      )
    );
  });

  it('leaves out the registered folder and git’s main checkout when the repository is registered at a linked worktree', async () => {
    // P22: a user who keeps their checkout as a git worktree registers that
    // worktree as the repository. It is theirs, and so is git's main checkout.
    db.update(repos).set({ path: side }).run();

    const found = (await discover()).map((w) => w.path);

    expect(found).not.toContain(path.resolve(side));
    expect(found).not.toContain(path.resolve(scratch.repo));
    expect(found).toContain(path.resolve(claudeX));
  });

  it('leaves out a worktree whose folder was deleted outside git', async () => {
    const gone = addWorktree(scratch.repo, path.join(scratch.root, 'elsewhere', 'gone'), 'gone');
    removeDirSync(gone);
    try {
      // git still lists it (as prunable) until someone prunes.
      expect(git(scratch.repo, 'worktree', 'list', '--porcelain')).toContain('gone');

      expect((await discover()).map((w) => w.path)).not.toContain(path.resolve(gone));
    } finally {
      git(scratch.repo, 'worktree', 'prune');
    }
  });

  it('refuses a repository that is not registered', async () => {
    await expect(discoverRepoWorktrees('no-such-repo')).rejects.toThrow(/no-such-repo/);
  });
});
