import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProvisionError } from '@shared/work-item-provision-error';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import {
  closeWorkItemRepo,
  createWorkItemTemplate,
  cutOrigin,
  git,
  lanePoolPath,
  openWorkItemRepo,
  primaryLane,
  pushBranch,
  readWorkItem,
  removeWorkItemTemplate,
  rowCount,
  settleWorkItem,
  type WorkItemRepo,
} from './test-support/work-item-harness';
import { createWorkItem, deleteWorkItem, retryWorkItemProvisioning } from './work-item-crud';

/**
 * The guards around creating and removing a work item's lane, on the real
 * stack (`test-support/work-item-harness.ts`): a request the real preflight
 * refuses writes nothing, a fork from the last-fetched copy of a base happens
 * only when the user chose it, and deleting an item never removes a folder the
 * user registered as a repository. Only Electron's keychain and the database
 * handle are supplied.
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

beforeAll(async () => {
  template = await createWorkItemTemplate();
});

afterAll(() => {
  removeWorkItemTemplate(template);
});

beforeEach(async () => {
  repo = await openWorkItemRepo(template, 'work-item-guards-');
});

afterEach(async () => {
  await closeWorkItemRepo(repo);
});

describe('work item create and delete guards', () => {
  it('refuses a request the preflight rejects, writing no work item and no lane', async () => {
    // `main` is the clone's own checkout: a lane cannot check it out again.
    const result = await createWorkItem({
      name: 'x',
      repoPath: repo.repoDir,
      existingBranch: 'main',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'branch_checked_out', branch: 'main' });
    expect(rowCount('work_items')).toBe(0);
    expect(rowCount('work_item_worktrees')).toBe(0);
    expect(fs.existsSync(lanePoolPath(repo))).toBe(false);
  });

  it("preflights a new lane's requested base before creating anything", async () => {
    const missing = await createWorkItem({
      name: 'api',
      repoPath: repo.repoDir,
      baseRef: 'no-such-base',
    });
    expect(missing.success).toBe(false);
    expect(rowCount('work_items')).toBe(0);
    expect(fs.existsSync(lanePoolPath(repo))).toBe(false);

    await pushBranch(repo, 'develop');
    const present = await createWorkItem({
      name: 'api',
      repoPath: repo.repoDir,
      baseRef: 'develop',
    });
    expect(present.success).toBe(true);
    if (!present.success) return;
    expect(primaryLane(present.data.item.id).baseBranch).toBe('develop');
    expect((await settleWorkItem(present.data.item.id)).provisionStatus).toBe('ready');
  });

  it('retry can fork from the last-fetched copy once the user chooses it, and records that', async () => {
    const lastFetched = await git(['rev-parse', 'origin/main'], repo.repoDir);
    cutOrigin(repo);
    const result = await createWorkItem({ name: 'offline', repoPath: repo.repoDir });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;
    const failed = await settleWorkItem(id);
    expect(parseProvisionError(failed.provisionError!)).toMatchObject({
      type: 'base_fetch_failed',
      lastFetchedSha: lastFetched,
    });

    const retried = await retryWorkItemProvisioning(id, { allowLocalCopy: true });
    expect(retried.success).toBe(true);
    const row = await settleWorkItem(id);

    expect(row.provisionStatus).toBe('ready');
    expect(primaryLane(id)).toMatchObject({ forkSource: 'local_copy', forkSha: lastFetched });
  });

  it('a plain retry never forks from the last-fetched copy', async () => {
    cutOrigin(repo);
    const result = await createWorkItem({ name: 'plain retry', repoPath: repo.repoDir });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;
    expect((await settleWorkItem(id)).provisionStatus).toBe('failed');

    expect((await retryWorkItemProvisioning(id)).success).toBe(true);
    const row = await settleWorkItem(id);

    // The base is still unreachable and the user did not choose the local copy:
    // no checkout was made (the pool folder itself is made before the fetch).
    expect(row.provisionStatus).toBe('failed');
    expect(parseProvisionError(row.provisionError!).type).toBe('base_fetch_failed');
    expect(fs.readdirSync(lanePoolPath(repo))).toEqual([]);
    expect(await git(['worktree', 'list', '--porcelain'], repo.repoDir)).not.toContain('chord/');
  });

  describe('deleting a work item whose lane was never created', () => {
    it('never removes the folder registered as the repository, even when it is a linked worktree', async () => {
      // A user who keeps their checkout as a git worktree registers that
      // worktree as the repository. A failed item's lane row holds the
      // repository path until provisioning lands, so deleting the item must
      // not treat that path as the lane's checkout.
      const registered = path.join(repo.root, 'my-checkout');
      await git(['worktree', 'add', '-b', 'my-work', registered], repo.repoDir);
      db.insert(repos).values({ id: 'repo-linked', path: registered, alias: 'my-checkout' }).run();
      cutOrigin(repo);

      const result = await createWorkItem({ name: 'doomed', repoId: 'repo-linked' });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect((await settleWorkItem(result.data.item.id)).provisionStatus).toBe('failed');

      const deleted = await deleteWorkItem(result.data.item.id);

      expect(deleted.success).toBe(true);
      expect(readWorkItem(result.data.item.id)).toBeUndefined();
      expect(fs.existsSync(path.join(registered, '.git'))).toBe(true);
      expect(await git(['worktree', 'list', '--porcelain'], repo.repoDir)).toContain('my-work');
    });
  });
});
