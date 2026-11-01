import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getChatSessionConfig,
  setChatSessionConfig,
} from '@main/core/agent-sessions/session-config-store';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { checkpoints } from '@main/db/schema-checkpoints';
import { agentSessions, repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { deleteWorktree } from './delete-worktree';
import { LaneWaitCancelledError, waitForLane } from './lane-readiness';

/**
 * Deleting one lane of a work item, against a REAL repository and the REAL
 * schema (`createMigratedTestDb`, foreign keys on as in the app). The whole
 * orchestration runs for real — session stop, lane waiters, workspace
 * release, checkpoint refs, `git worktree remove`, the row deletes. Only the
 * IPC emitter is substituted: it needs Electron's main process.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

vi.mock('@main/lib/events', () => ({ events: { emit: () => {} } }));

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

const REPO_ID = 'repo-1';
const ITEM_ID = 'item-1';
const PRIMARY_ID = 'lane-primary';
const SECONDARY_ID = 'lane-secondary';
const PRIMARY_BRANCH = 'chord/fix-login-a3f';
const SECONDARY_BRANCH = 'chord/fix-login-a3f--2';
const SECONDARY_REF = 'refs/chord/checkpoints/cp-secondary';
const PRIMARY_REF = 'refs/chord/checkpoints/cp-primary';

describe('deleteWorktree', () => {
  let root: string;
  let repoDir: string;
  let primaryPath: string;
  let secondaryPath: string;

  function laneRow(id: string) {
    return db.select().from(workItemWorktrees).where(eq(workItemWorktrees.id, id)).all()[0];
  }

  function sessionRow(id: string) {
    return db.select().from(agentSessions).where(eq(agentSessions.id, id)).all()[0];
  }

  function checkpointRow(id: string) {
    return db.select().from(checkpoints).where(eq(checkpoints.id, id)).all()[0];
  }

  async function refExists(ref: string): Promise<boolean> {
    return (await git(['for-each-ref', '--format=%(refname)', ref], repoDir)) === ref;
  }

  async function addLane(args: {
    id: string;
    branch: string;
    from: string;
    dir: string;
    isPrimary: boolean;
  }): Promise<string> {
    const checkout = path.join(root, 'pool', args.dir);
    await git(['worktree', 'add', '-b', args.branch, checkout, args.from], repoDir);
    db.insert(workItemWorktrees)
      .values({
        id: args.id,
        workItemId: ITEM_ID,
        path: checkout,
        branchName: args.branch,
        targetRef: 'origin/main',
        isPrimary: args.isPrimary ? 1 : 0,
        setupStatus: 'ok',
      })
      .run();
    return checkout;
  }

  async function addCheckpoint(id: string, ref: string, worktreeId: string, cwd: string) {
    const sha = await git(['rev-parse', 'HEAD'], cwd);
    await git(['update-ref', ref, sha], cwd);
    db.insert(checkpoints)
      .values({ id, workItemId: ITEM_ID, commitSha: sha, gitRef: ref, worktreeId })
      .run();
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-worktree-'));
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# repo\n');
    await git(['add', 'README.md'], repoDir);
    await git(['commit', '-m', 'init'], repoDir);

    db.insert(repos).values({ id: REPO_ID, path: repoDir, alias: 'repo' }).run();
    db.insert(workItems)
      .values({ id: ITEM_ID, name: 'fix login', repoId: REPO_ID, repoPath: repoDir })
      .run();

    primaryPath = await addLane({
      id: PRIMARY_ID,
      branch: PRIMARY_BRANCH,
      from: 'main',
      dir: 'fix-login-a3f',
      isPrimary: true,
    });
    db.update(workItems)
      .set({ repoPath: primaryPath, branchName: PRIMARY_BRANCH })
      .where(eq(workItems.id, ITEM_ID))
      .run();
    secondaryPath = await addLane({
      id: SECONDARY_ID,
      branch: SECONDARY_BRANCH,
      from: PRIMARY_BRANCH,
      dir: 'fix-login-a3f--2',
      isPrimary: false,
    });

    db.insert(agentSessions)
      .values([
        { id: 's-secondary', workItemId: ITEM_ID, kind: 'chat', worktreeId: SECONDARY_ID },
        { id: 's-primary', workItemId: ITEM_ID, kind: 'chat', worktreeId: PRIMARY_ID },
        // A null worktree_id means the primary (worktree-lookup.ts).
        { id: 's-legacy', workItemId: ITEM_ID, kind: 'terminal', worktreeId: null },
      ])
      .run();
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
    removeDirSync(root);
  });

  it('removes the checkout, keeps the branch, and leaves no row behind that names the lane', async () => {
    // Uncommitted work in the lane: the checkout goes anyway (the confirm named it).
    fs.writeFileSync(path.join(secondaryPath, 'draft.txt'), 'not committed\n');
    await addCheckpoint('cp-secondary', SECONDARY_REF, SECONDARY_ID, secondaryPath);
    await addCheckpoint('cp-primary', PRIMARY_REF, PRIMARY_ID, primaryPath);
    setChatSessionConfig('s-secondary', { model: 'opus' });

    const result = await deleteWorktree(SECONDARY_ID);

    expect(result).toEqual({ success: true, data: { workItemId: ITEM_ID } });
    // The checkout is gone from disk and from git's worktree list.
    expect(fs.existsSync(secondaryPath)).toBe(false);
    const worktreeList = await git(['worktree', 'list', '--porcelain'], repoDir);
    expect(worktreeList).not.toContain('fix-login-a3f--2');
    // Committed work survives: the branch is kept, as on work item delete.
    expect(await git(['rev-parse', '--verify', `refs/heads/${SECONDARY_BRANCH}`], repoDir)).toMatch(
      /^[0-9a-f]{40}$/
    );
    // The lane row and its sessions are gone. A session left with a NULL
    // worktree_id (the FK's ON DELETE SET NULL) would silently re-bind to
    // the primary, so the sessions must be deleted, not orphaned.
    expect(laneRow(SECONDARY_ID)).toBeUndefined();
    expect(sessionRow('s-secondary')).toBeUndefined();
    expect(getChatSessionConfig('s-secondary')).toEqual({});
    // Its checkpoint refs are released with their rows; the primary's stay.
    expect(await refExists(SECONDARY_REF)).toBe(false);
    expect(checkpointRow('cp-secondary')).toBeUndefined();
    expect(await refExists(PRIMARY_REF)).toBe(true);
    expect(checkpointRow('cp-primary')).toBeDefined();
    // The rest of the work item is untouched.
    expect(laneRow(PRIMARY_ID)).toMatchObject({ isPrimary: 1, path: primaryPath });
    expect(sessionRow('s-primary')?.worktreeId).toBe(PRIMARY_ID);
    expect(sessionRow('s-legacy')?.worktreeId).toBeNull();
    expect(fs.existsSync(path.join(primaryPath, '.git'))).toBe(true);
    expect(db.select().from(workItems).where(eq(workItems.id, ITEM_ID)).all()).toHaveLength(1);
  });

  it('releases anything still waiting on the lane, so an agent start never waits forever', async () => {
    db.update(workItemWorktrees)
      .set({ setupStatus: 'running' })
      .where(eq(workItemWorktrees.id, SECONDARY_ID))
      .run();
    const waiting = waitForLane(SECONDARY_ID, 'setup');
    // Attached before the delete: it cancels waiters first, before any await.
    const cancelled = expect(waiting).rejects.toBeInstanceOf(LaneWaitCancelledError);

    const result = await deleteWorktree(SECONDARY_ID);

    expect(result.success).toBe(true);
    await cancelled;
  });

  it('deletes the rows of a lane whose checkout was already removed outside Chord', async () => {
    await git(['worktree', 'remove', '--force', secondaryPath], repoDir);

    const result = await deleteWorktree(SECONDARY_ID);

    expect(result).toEqual({ success: true, data: { workItemId: ITEM_ID } });
    expect(laneRow(SECONDARY_ID)).toBeUndefined();
    expect(sessionRow('s-secondary')).toBeUndefined();
    expect(await git(['rev-parse', '--verify', `refs/heads/${SECONDARY_BRANCH}`], repoDir)).toMatch(
      /^[0-9a-f]{40}$/
    );
  });

  it('refuses the primary lane and touches nothing', async () => {
    const result = await deleteWorktree(PRIMARY_ID);

    expect(result).toEqual({ success: false, error: { type: 'primary_worktree' } });
    expect(laneRow(PRIMARY_ID)).toBeDefined();
    expect(sessionRow('s-primary')).toBeDefined();
    expect(fs.existsSync(path.join(primaryPath, '.git'))).toBe(true);
    expect(await git(['worktree', 'list', '--porcelain'], repoDir)).toContain('fix-login-a3f');
  });

  it('refuses a lane that holds the registered repository path, even when that folder is a linked worktree', async () => {
    // A user who keeps their checkout as a git worktree registers that
    // worktree as the repository (plan P22): `git worktree remove` would
    // happily delete it, so the guard cannot rely on "is it linked".
    const registered = path.join(root, 'my-checkout');
    await git(['worktree', 'add', '-b', 'my-work', registered, 'main'], repoDir);
    db.insert(repos).values({ id: 'repo-linked', path: registered, alias: 'my-checkout' }).run();
    db.update(workItemWorktrees)
      .set({ path: registered })
      .where(eq(workItemWorktrees.id, SECONDARY_ID))
      .run();

    const result = await deleteWorktree(SECONDARY_ID);

    expect(result).toEqual({ success: false, error: { type: 'repo_checkout', path: registered } });
    expect(fs.existsSync(path.join(registered, '.git'))).toBe(true);
    expect(await git(['worktree', 'list', '--porcelain'], repoDir)).toContain('my-checkout');
    expect(laneRow(SECONDARY_ID)).toBeDefined();
    expect(sessionRow('s-secondary')).toBeDefined();
  });

  it("refuses a lane that holds a repository's main checkout, registered or not", async () => {
    const otherClone = path.join(root, 'other-clone');
    await git(['clone', '-q', repoDir, otherClone], root);
    db.update(workItemWorktrees)
      .set({ path: otherClone })
      .where(eq(workItemWorktrees.id, SECONDARY_ID))
      .run();

    const result = await deleteWorktree(SECONDARY_ID);

    expect(result).toEqual({ success: false, error: { type: 'repo_checkout', path: otherClone } });
    expect(fs.statSync(path.join(otherClone, '.git')).isDirectory()).toBe(true);
    expect(laneRow(SECONDARY_ID)).toBeDefined();
  });

  it('reports an unknown lane as not found', async () => {
    expect(await deleteWorktree('no-such-lane')).toEqual({
      success: false,
      error: { type: 'not_found' },
    });
  });
});
