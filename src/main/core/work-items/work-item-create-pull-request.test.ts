import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeWorkItemRepo,
  createWorkItemTemplate,
  git,
  openWorkItemRepo,
  primaryLane,
  removeWorkItemTemplate,
  rowCount,
  settleWorkItem,
  type WorkItemRepo,
} from './test-support/work-item-harness';
import { createWorkItem } from './work-item-crud';

/**
 * A work item from a fork PR, on the real stack
 * (`test-support/work-item-harness.ts`): its branch exists only once the PR's
 * pull ref is fetched from origin, which createWorkItem does before the
 * preflight, and the lane is then user-named on that branch. Only Electron's
 * keychain and the database handle are supplied.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

let template: string;
let repo: WorkItemRepo;
let headSha: string;

beforeAll(async () => {
  template = await createWorkItemTemplate();
});

afterAll(() => {
  removeWorkItemTemplate(template);
});

beforeEach(async () => {
  repo = await openWorkItemRepo(template, 'work-item-fork-pr-');
  // The fork PR: a commit origin has only under the pull ref, as GitHub keeps it.
  await git(['commit', '--allow-empty', '-m', 'the fork PR'], repo.pusherDir);
  headSha = await git(['rev-parse', 'HEAD'], repo.pusherDir);
  await git(['push', 'origin', `${headSha}:refs/pull/1/head`], repo.pusherDir);
});

afterEach(async () => {
  await closeWorkItemRepo(repo);
});

const pullRequest = (number: number) => ({
  number,
  headRef: 'fix-typo',
  headOwner: 'alice',
  headCloneUrl: null,
  maintainerCanModify: false,
  baseRemote: 'origin',
});

describe('creating a work item from a fork PR', () => {
  it('fetches the PR branch before the preflight, and creates a user-named lane on it', async () => {
    const result = await createWorkItem({
      name: '#1 Fix the typo',
      repoPath: repo.repoDir,
      existingBranch: 'fix-typo',
      pullRequest: pullRequest(1),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.item.branchName).toBe('fix-typo');
    expect(await git(['rev-parse', 'refs/heads/fix-typo'], repo.repoDir)).toBe(headSha);
    expect(primaryLane(result.data.item.id).branchOrigin).toBe('user');
    // The preflight found the fetched branch like any existing one: the lane is on it.
    const row = await settleWorkItem(result.data.item.id);
    expect(row.provisionStatus).toBe('ready');
    expect(await git(['branch', '--show-current'], row.repoPath)).toBe('fix-typo');
    expect(await git(['rev-parse', 'HEAD'], row.repoPath)).toBe(headSha);
  });

  it('refuses a PR origin does not have, in the dialog, writing nothing', async () => {
    const result = await createWorkItem({
      name: '#99 Nope',
      repoPath: repo.repoDir,
      existingBranch: 'fix-typo',
      pullRequest: pullRequest(99),
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('pull_ref_not_found');
    expect(rowCount('work_items')).toBe(0);
    expect(rowCount('work_item_worktrees')).toBe(0);
    expect(await git(['branch', '--list', 'fix-typo'], repo.repoDir)).toBe('');
  });

  it('refuses a PR without the branch to check it out into, or with a base', async () => {
    const noBranch = await createWorkItem({
      name: '#1',
      repoPath: repo.repoDir,
      pullRequest: pullRequest(1),
    });
    const withBase = await createWorkItem({
      name: '#1',
      repoPath: repo.repoDir,
      existingBranch: 'fix-typo',
      baseRef: 'main',
      pullRequest: pullRequest(1),
    });

    for (const result of [noBranch, withBase]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.type).toBe('invalid_request');
    }
    expect(rowCount('work_items')).toBe(0);
    expect(await git(['branch', '--list', 'fix-typo'], repo.repoDir)).toBe('');
  });
});
