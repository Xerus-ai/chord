import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/result';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { testDb } from './test-support/work-items-test-db';
import { createWorkItem } from './work-item-crud';

/**
 * A pasted fork PR URL creates its work item through the one create request:
 * `existingBranch` (the name the dialog showed) plus the PR to fetch it from.
 * Over the REAL database (shipped migrations) and a REAL repository whose
 * origin holds `refs/pull/1/head`: the branch is fetched before the preflight
 * looks for it, the lane is a user-named checkout of it, and a PR that can't
 * be fetched is refused in the dialog with nothing written. The preflight and
 * worktree ENGINE are substituted as in the neighbouring suites (their git is
 * lane-preflight.test.ts and lane-checkout.test.ts).
 */
vi.mock('@main/db/client', async () => ({
  db: (await import('./test-support/work-items-test-db')).testDrizzle,
}));

vi.mock('./sync-queue-service', () => ({
  syncQueueService: { enqueueCreate: vi.fn(), enqueueUpdate: vi.fn(), enqueueDelete: vi.fn() },
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

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

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

vi.mock('@main/core/worktrees/workspace-bridge', () => ({
  acquireWorktreeWorkspace: vi.fn(),
  releaseWorktreeWorkspace: vi.fn(),
}));

vi.mock('@main/core/worktrees/worktree-cloud-sync', () => ({
  scheduleWorktreeCloudSync: vi.fn(),
}));

const mockProvision = vi.fn();
const mockPreflight = vi.fn();
vi.mock('./work-item-worktree', () => ({
  provisionWorkItemWorktree: (...args: unknown[]) => mockProvision(...args),
  preflightWorkItemLane: (...args: unknown[]) => mockPreflight(...args),
}));

vi.mock('@main/core/worktrees/lane-setup', () => ({
  runLaneSetup: vi.fn(),
}));

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

function count(table: string): number {
  return (testDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('creating a work item from a fork PR', () => {
  let root: string;
  let repoDir: string;
  let headSha: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPreflight.mockResolvedValue(ok(undefined));
    mockProvision.mockReturnValue(new Promise(() => {}));
    testDb.exec('DELETE FROM work_items');

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'create-fork-pr-'));
    const originDir = path.join(root, 'origin.git');
    const author = path.join(root, 'author');
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(originDir);
    await git(['init', '--bare'], originDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], originDir);
    fs.mkdirSync(author);
    await git(['init'], author);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], author);
    await git(['config', 'user.email', 'test@test.com'], author);
    await git(['config', 'user.name', 'Test'], author);
    await git(['commit', '--allow-empty', '-m', 'init'], author);
    await git(['push', originDir, 'main'], author);
    await git(['commit', '--allow-empty', '-m', 'the fork PR'], author);
    headSha = await git(['rev-parse', 'HEAD'], author);
    await git(['push', originDir, `${headSha}:refs/pull/1/head`], author);
    await git(['clone', originDir, repoDir], root);
  });

  afterEach(() => {
    removeDirSync(root);
  });

  const pullRequest = (number: number) => ({
    number,
    headRef: 'fix-typo',
    headOwner: 'alice',
    headCloneUrl: null,
    maintainerCanModify: false,
    baseRemote: 'origin',
  });

  it('fetches the PR branch before the preflight, and creates a user-named lane on it', async () => {
    const result = await createWorkItem({
      name: '#1 Fix the typo',
      repoPath: repoDir,
      existingBranch: 'fix-typo',
      pullRequest: pullRequest(1),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.item.branchName).toBe('fix-typo');
    expect(await git(['rev-parse', 'refs/heads/fix-typo'], repoDir)).toBe(headSha);
    expect(mockPreflight).toHaveBeenCalledWith(
      expect.objectContaining({ request: { kind: 'existing', branchName: 'fix-typo' } })
    );
    expect(
      testDb
        .prepare('SELECT branch_origin FROM work_item_worktrees WHERE work_item_id = ?')
        .get(result.data.item.id)
    ).toEqual({ branch_origin: 'user' });
  });

  it('refuses a PR origin does not have, in the dialog, writing nothing', async () => {
    const result = await createWorkItem({
      name: '#99 Nope',
      repoPath: repoDir,
      existingBranch: 'fix-typo',
      pullRequest: pullRequest(99),
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('pull_ref_not_found');
    expect(count('work_items')).toBe(0);
    expect(count('work_item_worktrees')).toBe(0);
    expect(mockPreflight).not.toHaveBeenCalled();
  });

  it('refuses a PR without the branch to check it out into, or with a base', async () => {
    const noBranch = await createWorkItem({
      name: '#1',
      repoPath: repoDir,
      pullRequest: pullRequest(1),
    });
    const withBase = await createWorkItem({
      name: '#1',
      repoPath: repoDir,
      existingBranch: 'fix-typo',
      baseRef: 'main',
      pullRequest: pullRequest(1),
    });

    for (const result of [noBranch, withBase]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.type).toBe('invalid_request');
    }
    expect(count('work_items')).toBe(0);
    expect(await git(['branch', '--list', 'fix-typo'], repoDir)).toBe('');
  });
});
