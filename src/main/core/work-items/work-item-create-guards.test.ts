import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { parseProvisionError } from '@shared/work-item-provision-error';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { testDb } from './test-support/work-items-test-db';
import { createWorkItem, deleteWorkItem, retryWorkItemProvisioning } from './work-item-crud';

/**
 * The guards around creating and removing a work item's lane, over the same
 * REAL database as work-item-crud.test.ts: a request the preflight refuses
 * writes nothing, a fork from a stale base happens only when the user chose
 * it, and deleting an item never removes a folder the user registered as a
 * repository. Only the worktree ENGINE is substituted (its git behaviour is
 * lane-checkout.test.ts and lane-preflight.test.ts).
 */
vi.mock('@main/db/client', async () => ({
  db: (await import('./test-support/work-items-test-db')).testDrizzle,
}));

const mockEnqueueCreate = vi.fn();
const mockEnqueueUpdate = vi.fn();
const mockEnqueueDelete = vi.fn();
vi.mock('./sync-queue-service', () => ({
  syncQueueService: {
    enqueueCreate: (...args: unknown[]) => mockEnqueueCreate(...args),
    enqueueUpdate: (...args: unknown[]) => mockEnqueueUpdate(...args),
    enqueueDelete: (...args: unknown[]) => mockEnqueueDelete(...args),
  },
}));

vi.mock('./git-state-capture', () => ({
  gitStateCaptureService: { kick: vi.fn() },
}));

vi.mock('@main/core/checkpoints/checkpoint-service', () => ({
  deleteWorkItemCheckpoints: vi.fn(),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: (key: string) =>
      Promise.resolve(
        key === 'localProject'
          ? { branchPrefixMode: 'custom', branchPrefix: 'chord', branchPrefixUsername: null }
          : 'claude'
      ),
  },
}));

const mockEventEmit = vi.fn();
vi.mock('@main/lib/events', () => ({
  events: { emit: (...args: unknown[]) => mockEventEmit(...args) },
}));

// cloud-work-items-client pulls in the account service, whose config module
// reads Electron's `app` at import time — unavailable under the Node runner.
// The pure body mappers under test stay real; only that import is cut.
vi.mock('@main/core/account/services/chord-account-service', () => ({
  chordAccountService: {
    getSession: () => Promise.resolve({ user: { userId: 'user-test-owner' } }),
    getCachedUserId: () => 'user-test-owner',
  },
}));
vi.mock('@main/db/kv', () => ({
  KV: class {
    get() {
      return Promise.resolve(null);
    }
    set() {
      return Promise.resolve();
    }
  },
}));

const mockAcquireWorkspace = vi.fn();
vi.mock('@main/core/worktrees/workspace-bridge', () => ({
  acquireWorktreeWorkspace: (...args: unknown[]) => mockAcquireWorkspace(...args),
  releaseWorktreeWorkspace: vi.fn(),
}));

const mockScheduleWorktreeSync = vi.fn();
vi.mock('@main/core/worktrees/worktree-cloud-sync', () => ({
  scheduleWorktreeCloudSync: (...args: unknown[]) => mockScheduleWorktreeSync(...args),
}));

const mockProvision = vi.fn();
const mockPreflight = vi.fn();
vi.mock('./work-item-worktree', () => ({
  provisionWorkItemWorktree: (...args: unknown[]) => mockProvision(...args),
  preflightWorkItemLane: (...args: unknown[]) => mockPreflight(...args),
}));

// Setup is its own state machine (worktrees/lane-setup.test.ts); what matters
// here is that a freshly provisioned lane is handed to it.
const mockRunLaneSetup = vi.fn();
vi.mock('@main/core/worktrees/lane-setup', () => ({
  runLaneSetup: (...args: unknown[]) => mockRunLaneSetup(...args),
}));

// Absolute on the host that runs the suite: `createWorkItem` resolves the repo
// path with the host's `path`, and a Windows spelling is relative on Linux.
const REPO_ROOT = path.resolve(path.sep, 'repo', 'root');
const WORKTREE = path.resolve(path.sep, 'repo', 'worktrees', 'chord-item-a1b2');
const FORK_SHA = '0123456789abcdef0123456789abcdef01234567';

function provisioned(branchName: string, overrides: Record<string, unknown> = {}) {
  return ok({
    worktreePath: WORKTREE,
    branchName,
    slug: branchName.split('/').pop(),
    targetRef: 'origin/main',
    forkSha: FORK_SHA,
    branchOrigin: 'chord',
    forkSource: 'fetched',
    ...overrides,
  });
}

function readPrimaryLane(workItemId: string): Record<string, unknown> {
  return {
    ...(testDb
      .prepare(
        `SELECT id, branch_name, base_branch, target_ref, fork_sha, slug, branch_origin, setup_status, fork_source
         FROM work_item_worktrees WHERE work_item_id = ? AND is_primary = 1`
      )
      .get(workItemId) as object),
  };
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

async function readRow(id: string) {
  const [row] = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  return row;
}

async function waitForProvisionSettled(id: string) {
  await vi.waitFor(async () => {
    const row = await readRow(id);
    expect(row.provisionStatus).not.toBe('provisioning');
  });
}

describe('work item create and delete guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreflight.mockResolvedValue(ok(undefined));
    testDb.exec('DELETE FROM work_items');
    testDb.exec('DELETE FROM repos');
  });

  it('refuses a request the preflight rejects, writing no work item and no lane', async () => {
    const refusal = {
      type: 'branch_checked_out',
      branch: 'main',
      path: REPO_ROOT,
      message: `main is already checked out in ${REPO_ROOT}.`,
    };
    mockPreflight.mockResolvedValue(err(refusal));

    const result = await createWorkItem({ name: 'x', repoPath: REPO_ROOT, existingBranch: 'main' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual(refusal);
    expect(mockPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: REPO_ROOT,
        request: { kind: 'existing', branchName: 'main' },
      })
    );
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM work_items').get()).toEqual({ n: 0 });
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM work_item_worktrees').get()).toEqual({ n: 0 });
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it("preflights a new lane's requested base before creating anything", async () => {
    mockProvision.mockResolvedValue(provisioned('chord/api-a1b2'));

    const result = await createWorkItem({ name: 'api', repoPath: REPO_ROOT, baseRef: 'develop' });

    expect(result.success).toBe(true);
    expect(mockPreflight).toHaveBeenCalledWith(
      expect.objectContaining({ request: { kind: 'new', baseRef: 'develop' } })
    );
  });

  it('retry can fork from the last-fetched copy once the user chooses it, and records that', async () => {
    mockProvision.mockResolvedValueOnce(
      err({
        type: 'base_fetch_failed',
        ref: 'origin/main',
        lastFetchedSha: FORK_SHA,
        message: 'Could not fetch origin/main.',
      })
    );
    const result = await createWorkItem({ name: 'offline', repoPath: REPO_ROOT });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;
    await waitForProvisionSettled(id);
    expect(parseProvisionError((await readRow(id)).provisionError!)).toMatchObject({
      type: 'base_fetch_failed',
      lastFetchedSha: FORK_SHA,
    });

    mockProvision.mockResolvedValueOnce(
      provisioned('chord/offline-a1b2', { forkSource: 'local_copy' })
    );
    const retried = await retryWorkItemProvisioning(id, { allowLocalCopy: true });
    expect(retried.success).toBe(true);
    await waitForProvisionSettled(id);

    expect(mockProvision).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowLocalCopy: true })
    );
    expect(readPrimaryLane(id)).toMatchObject({ fork_source: 'local_copy' });
  });

  it('a plain retry never forks from the last-fetched copy', async () => {
    mockProvision.mockResolvedValueOnce(err({ type: 'worktree_failed', message: 'first try' }));
    const result = await createWorkItem({ name: 'plain retry', repoPath: REPO_ROOT });
    expect(result.success).toBe(true);
    if (!result.success) return;
    await waitForProvisionSettled(result.data.item.id);

    mockProvision.mockResolvedValueOnce(provisioned('chord/plain-retry-a1b2'));
    await retryWorkItemProvisioning(result.data.item.id);
    await waitForProvisionSettled(result.data.item.id);

    expect(mockProvision).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowLocalCopy: false })
    );
  });

  describe('deleting a work item whose lane was never created', () => {
    let root: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-item-delete-'));
    });

    afterEach(() => {
      removeDirSync(root);
    });

    it('never removes the folder registered as the repository, even when it is a linked worktree', async () => {
      // A user who keeps their checkout as a git worktree registers that
      // worktree as the repository. A failed item's lane row holds the
      // repository path until provisioning lands, so deleting the item must
      // not treat that path as the lane's checkout.
      const mainRepo = path.join(root, 'main');
      fs.mkdirSync(mainRepo);
      await git(['init'], mainRepo);
      await git(['config', 'user.email', 'test@test.com'], mainRepo);
      await git(['config', 'user.name', 'Test'], mainRepo);
      await git(['commit', '--allow-empty', '-m', 'init'], mainRepo);
      const registered = path.join(root, 'my-checkout');
      await git(['worktree', 'add', '-b', 'my-work', registered], mainRepo);
      testDb
        .prepare('INSERT INTO repos (id, path, alias) VALUES (?, ?, ?)')
        .run('repo-linked', registered, 'my-checkout');

      mockProvision.mockResolvedValue(err({ type: 'worktree_failed', message: 'boom' }));
      const result = await createWorkItem({ name: 'doomed', repoId: 'repo-linked' });
      expect(result.success).toBe(true);
      if (!result.success) return;
      await waitForProvisionSettled(result.data.item.id);
      expect((await readRow(result.data.item.id)).provisionStatus).toBe('failed');

      const deleted = await deleteWorkItem(result.data.item.id);

      expect(deleted.success).toBe(true);
      expect(await readRow(result.data.item.id)).toBeUndefined();
      expect(fs.existsSync(path.join(registered, '.git'))).toBe(true);
      expect(await git(['worktree', 'list', '--porcelain'], mainRepo)).toContain('my-work');
    });
  });
});
