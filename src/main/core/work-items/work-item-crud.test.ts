import path from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { parseProvisionError } from '@shared/work-item-provision-error';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { testDb } from './test-support/work-items-test-db';
import { createWorkItem, retryWorkItemProvisioning, updateWorkItem } from './work-item-crud';

/**
 * Drives the REAL createWorkItem/retryWorkItemProvisioning state machine over
 * a REAL SQLite database built from the shipped migrations (same handle
 * substitution as script-approval.test.ts — the app's better-sqlite3
 * build targets Electron's ABI). Only the worktree ENGINE is substituted: its
 * git behaviour is covered by work-item-worktree-git.test.ts; what is under
 * test here is the provisioning lifecycle around it — instant row creation,
 * the ready/failed transitions, the cloud-create deferral, and the retry gate.
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

function readPrimaryWorktrees(workItemId: string): unknown[] {
  return testDb
    .prepare(
      'SELECT path, branch_name FROM work_item_worktrees WHERE work_item_id = ? AND is_primary = 1'
    )
    .all(workItemId)
    .map((row) => ({ ...(row as object) }));
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

describe('work item provisioning lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreflight.mockResolvedValue(ok(undefined));
    testDb.exec('DELETE FROM work_items');
  });

  it('returns instantly with a provisioning row, then flips to ready with the worktree path', async () => {
    let releaseProvision!: (value: unknown) => void;
    mockProvision.mockReturnValue(new Promise((r) => (releaseProvision = r)));

    const result = await createWorkItem({ name: 'fix login', repoPath: REPO_ROOT });
    expect(result.success).toBe(true);
    if (!result.success) return;

    // The instant-handover contract: row exists BEFORE the worktree does.
    expect(result.data.item.provisionStatus).toBe('provisioning');
    // Sync acts only for the account that made the row (devstation-as2).
    expect(result.data.item.ownerAccountId).toBe('user-test-owner');
    expect(result.data.item.repoPath).toBe(REPO_ROOT);
    expect(result.data.item.branchName).toMatch(/^chord\/fix-login/);
    expect(mockEnqueueCreate).not.toHaveBeenCalled();
    // "Every work item has exactly one primary worktree" holds from creation:
    // it points at the repo root until provisioning moves it.
    expect(readPrimaryWorktrees(result.data.item.id)).toEqual([
      { path: REPO_ROOT, branch_name: result.data.item.branchName },
    ]);
    expect(mockAcquireWorkspace).not.toHaveBeenCalled();

    releaseProvision(provisioned('chord/fix-login-a1b2'));
    await waitForProvisionSettled(result.data.item.id);

    const row = await readRow(result.data.item.id);
    expect(row.provisionStatus).toBe('ready');
    expect(row.repoPath).toBe(WORKTREE);
    expect(mockEnqueueCreate).toHaveBeenCalledTimes(1);
    expect(readPrimaryWorktrees(result.data.item.id)).toEqual([
      { path: WORKTREE, branch_name: 'chord/fix-login-a1b2' },
    ]);
    expect(mockScheduleWorktreeSync).toHaveBeenCalledWith(result.data.item.id);
    expect(mockAcquireWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ path: WORKTREE, isPrimary: 1 })
    );
    // The lane records where it forked from and where its PR goes, and its
    // setup starts as tracked state rather than a fire-and-forget terminal.
    const lane = readPrimaryLane(result.data.item.id);
    expect(lane).toMatchObject({
      target_ref: 'origin/main',
      fork_sha: FORK_SHA,
      slug: 'fix-login-a1b2',
      branch_origin: 'chord',
      setup_status: 'pending',
    });
    // Setup asks the user, through the app's trust prompt, about an unapproved config.
    expect(mockRunLaneSetup).toHaveBeenCalledWith(lane.id, askScriptApproval);
    expect(mockEventEmit).toHaveBeenCalledWith(expect.anything(), {
      workItemId: result.data.item.id,
      provisionStatus: 'ready',
    });
  });

  it('marks the row failed with the error, and never registers it with the cloud', async () => {
    mockProvision.mockResolvedValue(
      err({ type: 'worktree_failed', message: 'Could not create a git worktree: boom' })
    );

    const result = await createWorkItem({ name: 'doomed', repoPath: REPO_ROOT });
    expect(result.success).toBe(true);
    if (!result.success) return;
    await waitForProvisionSettled(result.data.item.id);

    const row = await readRow(result.data.item.id);
    expect(row.provisionStatus).toBe('failed');
    // Stored typed, so the banner can offer the action that fits the error.
    expect(parseProvisionError(row.provisionError!)).toEqual({
      type: 'worktree_failed',
      message: 'Could not create a git worktree: boom',
    });
    expect(mockEnqueueCreate).not.toHaveBeenCalled();
    expect(mockEventEmit).toHaveBeenCalledWith(expect.anything(), {
      workItemId: result.data.item.id,
      provisionStatus: 'failed',
      error: { type: 'worktree_failed', message: 'Could not create a git worktree: boom' },
    });
  });

  it('retry re-runs provisioning on a failed row and can bring it to ready', async () => {
    mockProvision.mockResolvedValueOnce(err({ type: 'worktree_failed', message: 'first try' }));

    const result = await createWorkItem({ name: 'retry me', repoPath: REPO_ROOT });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;
    await waitForProvisionSettled(id);
    expect((await readRow(id)).provisionStatus).toBe('failed');

    mockProvision.mockResolvedValueOnce(provisioned('chord/retry-me-a1b2'));
    const retried = await retryWorkItemProvisioning(id);
    expect(retried.success).toBe(true);
    await waitForProvisionSettled(id);

    const row = await readRow(id);
    expect(row.provisionStatus).toBe('ready');
    expect(row.provisionError).toBeNull();
    expect(mockEnqueueCreate).toHaveBeenCalledTimes(1);
  });

  it('retry refuses rows that are not failed', async () => {
    mockProvision.mockResolvedValue(provisioned('chord/done-a1b2'));
    const result = await createWorkItem({ name: 'done', repoPath: REPO_ROOT });
    expect(result.success).toBe(true);
    if (!result.success) return;
    await waitForProvisionSettled(result.data.item.id);

    const retried = await retryWorkItemProvisioning(result.data.item.id);
    expect(retried.success).toBe(false);
    if (!retried.success) expect(retried.error.type).toBe('not_failed');

    const missing = await retryWorkItemProvisioning('no-such-id');
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.type).toBe('not_found');
  });

  it('defers cloud updates while provisioning — the later create carries the edit', async () => {
    let releaseProvision!: (value: unknown) => void;
    mockProvision.mockReturnValue(new Promise((r) => (releaseProvision = r)));

    const result = await createWorkItem({ name: 'old name', repoPath: REPO_ROOT });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;

    await updateWorkItem({ id, name: 'new name' });
    expect(mockEnqueueUpdate).not.toHaveBeenCalled();

    releaseProvision(provisioned('chord/old-name-a1b2'));
    await waitForProvisionSettled(id);

    // The create enqueued at completion reads the row fresh — rename included.
    expect(mockEnqueueCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'new name' }));

    await updateWorkItem({ id, name: 'renamed again' });
    expect(mockEnqueueUpdate).toHaveBeenCalledTimes(1);
  });

  it('forks a new branch from the requested base, never reusing it as the branch', async () => {
    mockProvision.mockResolvedValue(provisioned('chord/api-a1b2'));

    const result = await createWorkItem({ name: 'api', repoPath: REPO_ROOT, baseRef: 'develop' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    await waitForProvisionSettled(result.data.item.id);

    expect(mockProvision).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { kind: 'new', branchName: result.data.item.branchName, baseRef: 'develop' },
      })
    );
    expect(result.data.item.branchName).not.toBe('develop');
  });

  it('checks out an existing branch as a user-named lane', async () => {
    mockProvision.mockResolvedValue(
      provisioned('feature/login', { branchOrigin: 'user', slug: 'login' })
    );

    const result = await createWorkItem({
      name: 'login',
      repoPath: REPO_ROOT,
      existingBranch: 'feature/login',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.item.branchName).toBe('feature/login');
    expect(readPrimaryLane(result.data.item.id)).toMatchObject({ branch_origin: 'user' });
    await waitForProvisionSettled(result.data.item.id);

    expect(mockProvision).toHaveBeenCalledWith(
      expect.objectContaining({ request: { kind: 'existing', branchName: 'feature/login' } })
    );
  });

  it('retries with the same request after a failure', async () => {
    mockProvision.mockResolvedValueOnce(
      err({
        type: 'branch_checked_out',
        branch: 'main',
        path: REPO_ROOT,
        message: `main is checked out in ${REPO_ROOT}`,
      })
    );

    const result = await createWorkItem({ name: 'x', repoPath: REPO_ROOT, existingBranch: 'main' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const id = result.data.item.id;
    await waitForProvisionSettled(id);
    expect((await readRow(id)).provisionError).toContain('checked out');

    mockProvision.mockResolvedValueOnce(provisioned('main', { branchOrigin: 'user' }));
    const retried = await retryWorkItemProvisioning(id);
    expect(retried.success).toBe(true);
    await waitForProvisionSettled(id);

    expect(mockProvision).toHaveBeenLastCalledWith(
      expect.objectContaining({ request: { kind: 'existing', branchName: 'main' } })
    );
  });
});
