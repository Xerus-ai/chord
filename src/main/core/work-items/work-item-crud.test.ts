import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProvisionError } from '@shared/work-item-provision-error';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { readLaneSetupLog } from '@main/core/worktrees/lane-setup';
import {
  blockLanePool,
  closeWorkItemRepo,
  createWorkItemTemplate,
  cutOrigin,
  git,
  openWorkItemRepo,
  OWNER_ID,
  primaryLane,
  pushBranch,
  queuedSync,
  removeWorkItemTemplate,
  restoreOrigin,
  settleWorkItem,
  unblockLanePool,
  type WorkItemRepo,
} from './test-support/work-item-harness';
import { createWorkItem, retryWorkItemProvisioning, updateWorkItem } from './work-item-crud';

/**
 * The createWorkItem / retryWorkItemProvisioning lifecycle on the real stack
 * (`test-support/work-item-harness.ts`): a clone of a bare origin, real
 * preflight and provisioning (`git worktree add` into the settings' worktree
 * root), real lane setup, the real sync queue, settings and account on a
 * database built from the shipped migrations. Only Electron's keychain and the
 * database handle are supplied, as the other worktree suites do.
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
  repo = await openWorkItemRepo(template, 'work-item-crud-');
});

afterEach(async () => {
  await closeWorkItemRepo(repo);
});

describe('work item provisioning lifecycle', () => {
  it('returns instantly with a provisioning row, then flips to ready with the worktree path', async () => {
    const result = await createWorkItem({ name: 'fix login', repoPath: repo.repoDir });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const { item } = result.data;

    // The instant-handover contract: the row exists before the worktree does.
    expect(item.provisionStatus).toBe('provisioning');
    // Sync acts only for the account that made the row (devstation-as2).
    expect(item.ownerAccountId).toBe(OWNER_ID);
    expect(item.repoPath).toBe(path.resolve(repo.repoDir));
    expect(item.branchName).toMatch(/^chord\/fix-login/);
    expect(queuedSync(item.id)).toEqual([]);
    // "Every work item has exactly one primary worktree" holds from creation:
    // it points at the repo root until provisioning moves it.
    const before = primaryLane(item.id);
    expect({ path: before.path, branchName: before.branchName }).toEqual({
      path: path.resolve(repo.repoDir),
      branchName: item.branchName,
    });
    expect(workspaceRegistry.get(before.id)).toBeUndefined();

    const row = await settleWorkItem(item.id);

    expect(row.provisionStatus).toBe('ready');
    expect(path.dirname(path.dirname(row.repoPath))).toBe(repo.poolRoot);
    expect(await git(['branch', '--show-current'], row.repoPath)).toBe(row.branchName);
    expect(queuedSync(item.id)).toMatchObject([
      { operation: 'create', payload: { name: 'fix login' } },
    ]);
    // The lane records where it forked from and where its PR goes; setup ran
    // as tracked state, and the workspace serving its panels was acquired.
    const lane = primaryLane(item.id);
    expect(lane).toMatchObject({
      path: row.repoPath,
      branchName: row.branchName,
      targetRef: 'origin/main',
      forkSha: await git(['rev-parse', 'origin/main'], repo.repoDir),
      slug: path.basename(row.repoPath),
      branchOrigin: 'chord',
      forkSource: 'fetched',
      setupStatus: 'ok',
    });
    expect(await readLaneSetupLog(lane.id)).toContain('No setup script');
    expect(workspaceRegistry.get(lane.id)).toBeDefined();
  });

  it('marks the row failed with the error, and never registers it with the cloud', async () => {
    const lastFetched = await git(['rev-parse', 'origin/main'], repo.repoDir);
    cutOrigin(repo);

    const result = await createWorkItem({ name: 'doomed', repoPath: repo.repoDir });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = await settleWorkItem(result.data.item.id);

    expect(row.provisionStatus).toBe('failed');
    // Stored typed, so the banner can offer the action that fits the error.
    expect(parseProvisionError(row.provisionError!)).toMatchObject({
      type: 'base_fetch_failed',
      ref: 'origin/main',
      lastFetchedSha: lastFetched,
    });
    expect(queuedSync(row.id)).toEqual([]);
    expect(primaryLane(row.id).path).toBe(path.resolve(repo.repoDir));
  });

  it('retry re-runs provisioning on a failed row and can bring it to ready', async () => {
    cutOrigin(repo);
    const result = await createWorkItem({ name: 'retry me', repoPath: repo.repoDir });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;
    expect((await settleWorkItem(id)).provisionStatus).toBe('failed');

    restoreOrigin(repo);
    const retried = await retryWorkItemProvisioning(id);
    expect(retried.success).toBe(true);
    const row = await settleWorkItem(id);

    expect(row.provisionStatus).toBe('ready');
    expect(row.provisionError).toBeNull();
    expect(queuedSync(id)).toMatchObject([{ operation: 'create', payload: { name: 'retry me' } }]);
  });

  it('retry refuses rows that are not failed', async () => {
    const result = await createWorkItem({ name: 'done', repoPath: repo.repoDir });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((await settleWorkItem(result.data.item.id)).provisionStatus).toBe('ready');

    const retried = await retryWorkItemProvisioning(result.data.item.id);
    expect(retried.success).toBe(false);
    if (!retried.success) expect(retried.error.type).toBe('not_failed');

    const missing = await retryWorkItemProvisioning('no-such-id');
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.type).toBe('not_found');
  });

  it('defers cloud updates while provisioning — the later create carries the edit', async () => {
    const result = await createWorkItem({ name: 'old name', repoPath: repo.repoDir });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;

    await updateWorkItem({ id, name: 'new name' });
    expect(queuedSync(id)).toEqual([]);

    await settleWorkItem(id);
    // The create enqueued at completion reads the row fresh — rename included.
    expect(queuedSync(id)).toMatchObject([{ operation: 'create', payload: { name: 'new name' } }]);

    // Once ready an edit is queued, merged into the create still waiting to send.
    await updateWorkItem({ id, name: 'renamed again' });
    expect(queuedSync(id)).toMatchObject([
      { operation: 'create', payload: { name: 'renamed again' } },
    ]);
  });

  it('forks a new branch from the requested base, never reusing it as the branch', async () => {
    const developSha = await pushBranch(repo, 'develop');

    const result = await createWorkItem({
      name: 'api',
      repoPath: repo.repoDir,
      baseRef: 'develop',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = await settleWorkItem(result.data.item.id);

    expect(row.provisionStatus).toBe('ready');
    expect(row.branchName).toMatch(/^chord\/api/);
    expect(row.branchName).not.toBe('develop');
    expect(primaryLane(row.id)).toMatchObject({ baseBranch: 'develop', forkSha: developSha });
    expect(await git(['branch', '--show-current'], row.repoPath)).toBe(row.branchName);
    expect(await git(['rev-parse', 'HEAD'], row.repoPath)).toBe(developSha);
  });

  it('checks out an existing branch as a user-named lane', async () => {
    await git(['branch', 'feature/login'], repo.repoDir);

    const result = await createWorkItem({
      name: 'login',
      repoPath: repo.repoDir,
      existingBranch: 'feature/login',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.item.branchName).toBe('feature/login');
    expect(primaryLane(result.data.item.id).branchOrigin).toBe('user');
    const row = await settleWorkItem(result.data.item.id);

    expect(row.provisionStatus).toBe('ready');
    expect(await git(['branch', '--show-current'], row.repoPath)).toBe('feature/login');
  });

  it('retries with the same request after a failure', async () => {
    await git(['branch', 'feature/retry'], repo.repoDir);
    // A file where the repository's lane pool goes: the checkout cannot be made.
    blockLanePool(repo);

    const result = await createWorkItem({
      name: 'x',
      repoPath: repo.repoDir,
      existingBranch: 'feature/retry',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;
    const failed = await settleWorkItem(id);
    expect(failed.provisionStatus).toBe('failed');
    expect(failed.provisionError).toBeTruthy();

    unblockLanePool(repo);
    expect((await retryWorkItemProvisioning(id)).success).toBe(true);
    const row = await settleWorkItem(id);

    // The retry asked for the same existing branch: the lane is on it, user-named.
    expect(row.provisionStatus).toBe('ready');
    expect(fs.existsSync(row.repoPath)).toBe(true);
    expect(await git(['branch', '--show-current'], row.repoPath)).toBe('feature/retry');
    expect(primaryLane(id).branchOrigin).toBe('user');
  });
});
