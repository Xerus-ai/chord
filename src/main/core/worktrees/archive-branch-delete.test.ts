import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Also delete the branch" (plan §"Decisions for Phase 5", Archive): offered,
 * and honoured, only when GitHub reports the lane's PR merged, the branch is
 * not ahead of the merged head, and nothing is uncommitted, so nothing is
 * lost. The PR is a row in the real pull_requests mirror the GitHub sync
 * writes; the repository and lanes are real.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { pullRequests } = await import('@main/db/schema');
const { checkpoints } = await import('@main/db/schema-checkpoints');
const { repos, workItems, workItemWorktrees } = await import('@main/db/schema-work-items');
const { parseGitHubRepository } = await import('@shared/github-repository');
const { addLane, createLaneRepo, git, insertRepoAndItems, readLaneRow, removeLaneRepo } =
  await import('@main/core/lane-runs/_testing/lane-run-fixture');
const { decideArchiveBranchDelete } = await import('./archive-branch-delete');
const { archiveWorktree } = await import('./archive-worktree');
const { listArchivedLanes } = await import('./archived-lanes');
const { inspectWorktreeArchive } = await import('./service');

type LaneRepo = Awaited<ReturnType<typeof createLaneRepo>>;

const REMOTE = 'https://github.com/acme/app.git';
let repo: LaneRepo;
let lane: string;

async function branchExists(branch: string): Promise<boolean> {
  return (await git(['branch', '--list', branch], repo.repoDir)) !== '';
}

function insertPr(status: 'open' | 'merged', headRefOid: string): void {
  const repositoryUrl = parseGitHubRepository(REMOTE)?.repositoryUrl as string;
  db.insert(pullRequests)
    .values({
      url: 'https://github.com/acme/app/pull/7',
      repositoryUrl,
      baseRefName: 'main',
      baseRefOid: headRefOid,
      headRepositoryUrl: repositoryUrl,
      headRefName: 'chord/a2',
      headRefOid,
      identifier: '#7',
      title: 'Lane a2',
      status,
    })
    .run();
}

beforeEach(async () => {
  db.delete(pullRequests).run();
  db.delete(checkpoints).run();
  db.delete(workItemWorktrees).run();
  db.delete(workItems).run();
  db.delete(repos).run();
  repo = await createLaneRepo('chord-archive-branch-');
  await git(['remote', 'add', 'origin', REMOTE], repo.repoDir);
  insertRepoAndItems(repo.repoDir, ['item-a']);
  await addLane({ repo, laneId: 'lane-a', workItemId: 'item-a', dir: 'a' });
  lane = await addLane({
    repo,
    laneId: 'lane-a2',
    workItemId: 'item-a',
    dir: 'a2',
    isPrimary: false,
  });
  writeFileSync(path.join(lane, 'work.md'), 'merged work\n');
  await git(['add', 'work.md'], lane);
  await git(['commit', '-m', 'work'], lane);
});

afterEach(async () => {
  await removeLaneRepo(repo);
});

describe('decideArchiveBranchDelete', () => {
  it('allows it only for a merged PR, a branch not ahead of it, and nothing uncommitted', () => {
    const merged = { prStatus: 'merged', aheadOfPrHead: 0, uncommitted: 0 };
    expect(decideArchiveBranchDelete(merged)).toBe(true);
    expect(decideArchiveBranchDelete({ ...merged, prStatus: 'open' })).toBe(false);
    expect(decideArchiveBranchDelete({ ...merged, prStatus: null })).toBe(false);
    expect(decideArchiveBranchDelete({ ...merged, aheadOfPrHead: 1 })).toBe(false);
    // The PR's head is not in this clone: whether the branch is ahead is unknown.
    expect(decideArchiveBranchDelete({ ...merged, aheadOfPrHead: null })).toBe(false);
    expect(decideArchiveBranchDelete({ ...merged, uncommitted: 2 })).toBe(false);
  });
});

describe('archiving with "Also delete the branch"', () => {
  it('is offered for a merged lane, and deletes the branch', async () => {
    insertPr('merged', await git(['rev-parse', 'HEAD'], lane));

    const inspected = await inspectWorktreeArchive('lane-a2');
    expect(inspected.success && inspected.data.branchDeletable).toBe(true);

    const result = await archiveWorktree('lane-a2', { deleteBranch: true });
    expect(result.success).toBe(true);
    expect(await branchExists('chord/a2')).toBe(false);
    // Nothing to restore from: the row offers Delete only.
    expect((await listArchivedLanes('item-a'))[0].restorable).toBe(false);
  });

  it('is not offered for an open PR, and refused if asked anyway, changing nothing', async () => {
    insertPr('open', await git(['rev-parse', 'HEAD'], lane));

    const inspected = await inspectWorktreeArchive('lane-a2');
    expect(inspected.success && inspected.data.branchDeletable).toBe(false);

    const result = await archiveWorktree('lane-a2', { deleteBranch: true });
    expect(result.success ? null : result.error.type).toBe('branch_not_deletable');
    expect(await branchExists('chord/a2')).toBe(true);
    expect(readLaneRow('lane-a2').archivedAt).toBeNull();
  });

  it('is not offered when the branch has commits after the merged head', async () => {
    insertPr('merged', await git(['rev-parse', 'HEAD'], lane));
    writeFileSync(path.join(lane, 'later.md'), 'after the merge\n');
    await git(['add', 'later.md'], lane);
    await git(['commit', '-m', 'later'], lane);

    const inspected = await inspectWorktreeArchive('lane-a2');
    expect(inspected.success && inspected.data.branchDeletable).toBe(false);
  });

  it('is not offered with uncommitted work', async () => {
    insertPr('merged', await git(['rev-parse', 'HEAD'], lane));
    writeFileSync(path.join(lane, 'draft.md'), 'not committed\n');

    const inspected = await inspectWorktreeArchive('lane-a2');
    expect(inspected.success && inspected.data.branchDeletable).toBe(false);
  });
});
