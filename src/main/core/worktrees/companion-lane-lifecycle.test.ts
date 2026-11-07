import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * devstation-4x42.242: a lane nested in a companion worktree takes that
 * worktree along through archive, restore and delete, and a companion holding
 * the user's own work refuses the removal before anything changes. Real
 * repositories and real lanes; Electron's keychain and the database are the
 * substitutes the other worktree suites use.
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
const { checkpoints } = await import('@main/db/schema-checkpoints');
const { repos, workItems, workItemWorktrees } = await import('@main/db/schema-work-items');
const { addLane, createLaneRepo, git, insertRepoAndItems, readLaneRow, removeLaneRepo } =
  await import('@main/core/lane-runs/_testing/lane-run-fixture');
const { provisionCompanionCheckout } = await import('@main/core/work-items/companion-checkout');
const { archiveWorktree } = await import('./archive-worktree');
const { restoreWorktree } = await import('./restore-worktree');
const { deleteWorktree } = await import('./delete-worktree');
const { deleteWorkItem } = await import('@main/core/work-items/work-item-crud');
const { releaseWorktreeWorkspace } = await import('./workspace-bridge');

type LaneRepo = Awaited<ReturnType<typeof createLaneRepo>>;

let repo: LaneRepo;
let companionRepo: string;
let companionPath: string;
let lane: string;

async function companionWorktrees(): Promise<string> {
  return git(['worktree', 'list', '--porcelain'], companionRepo);
}

beforeEach(async () => {
  db.delete(checkpoints).run();
  db.delete(workItemWorktrees).run();
  db.delete(workItems).run();
  db.delete(repos).run();
  repo = await createLaneRepo('chord-companion-lane-');
  // The companion: a repository of its own that ignores the folder the app sits at.
  companionRepo = path.join(repo.root, 'companion');
  await git(['init', companionRepo], repo.root);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], companionRepo);
  await git(['config', 'user.email', 'test@test.com'], companionRepo);
  await git(['config', 'user.name', 'Test'], companionRepo);
  writeFileSync(path.join(companionRepo, '.gitignore'), '/app/\n');
  await git(['add', '.gitignore'], companionRepo);
  await git(['commit', '-m', 'ignore the app'], companionRepo);

  insertRepoAndItems(repo.repoDir, ['item-c']);
  await addLane({ repo, laneId: 'lane-p', workItemId: 'item-c', dir: 'p' });
  const made = await provisionCompanionCheckout({
    companion: { path: companionRepo, appFolder: 'app' },
    poolPath: path.join(repo.root, 'pool'),
    slug: 'c',
    laneBranch: 'chord/c',
  });
  if (!made.success) throw new Error(made.error.message);
  companionPath = made.data.companionPath;
  lane = made.data.appPath;
  await git(['worktree', 'add', '-b', 'chord/c', lane, 'main'], repo.repoDir);
  db.insert(workItemWorktrees)
    .values({
      id: 'lane-c',
      workItemId: 'item-c',
      path: lane,
      branchName: 'chord/c',
      isPrimary: 0,
      targetRef: 'main',
      setupStatus: 'ok',
      companionPath,
      companionRepoPath: companionRepo,
    })
    .run();
});

afterEach(async () => {
  await removeLaneRepo(repo);
});

describe('a lane nested in a companion worktree', () => {
  it('archives with its companion worktree, and restores both from their branches', async () => {
    const archived = await archiveWorktree('lane-c');
    expect(archived.success).toBe(true);
    expect(existsSync(lane)).toBe(false);
    expect(existsSync(companionPath)).toBe(false);
    expect(await git(['branch', '--list', 'companion/chord/c'], companionRepo)).toContain(
      'companion/chord/c'
    );

    const restored = await restoreWorktree('lane-c');
    expect(restored.success).toBe(true);
    expect(await git(['branch', '--show-current'], companionPath)).toBe('companion/chord/c');
    expect(await git(['branch', '--show-current'], lane)).toBe('chord/c');
    expect(await git(['status', '--porcelain'], companionPath)).toBe('');
    expect(readLaneRow('lane-c').archivedAt).toBeNull();
    await vi.waitFor(() => expect(readLaneRow('lane-c').setupStatus).toBe('ok'), {
      timeout: 15_000,
    });
    await releaseWorktreeWorkspace('lane-c');
  });

  it('refuses to archive while the companion holds work of its own, changing nothing', async () => {
    writeFileSync(path.join(companionPath, 'notes.md'), 'mine\n');

    const result = await archiveWorktree('lane-c');

    expect(result).toMatchObject({
      success: false,
      error: { type: 'companion_has_changes', path: companionPath },
    });
    expect(existsSync(lane)).toBe(true);
    expect(readLaneRow('lane-c').archivedAt).toBeNull();
  });

  it('puts the companion worktree away again when the restored lane checkout is refused', async () => {
    await archiveWorktree('lane-c');
    // The lane's branch is checked out somewhere else meanwhile.
    await git(['worktree', 'add', path.join(repo.root, 'elsewhere'), 'chord/c'], repo.repoDir);

    const result = await restoreWorktree('lane-c');

    expect(result).toMatchObject({ success: false, error: { type: 'branch_checked_out' } });
    expect(existsSync(companionPath)).toBe(false);
    expect(await companionWorktrees()).not.toContain('pool/c');
    expect(readLaneRow('lane-c').archivedAt).not.toBeNull();
  });

  // Review round 1 P3: a restore that had to make the companion branch (it was deleted meanwhile)
  // deletes it again when the lane checkout is then refused, as a failed create does.
  it('deletes the companion branch a refused restore made', async () => {
    await archiveWorktree('lane-c');
    await git(['branch', '-D', 'companion/chord/c'], companionRepo);
    await git(['worktree', 'add', path.join(repo.root, 'elsewhere'), 'chord/c'], repo.repoDir);

    const result = await restoreWorktree('lane-c');

    expect(result).toMatchObject({ success: false, error: { type: 'branch_checked_out' } });
    expect(existsSync(companionPath)).toBe(false);
    expect(await git(['branch', '--list', 'companion/*'], companionRepo)).toBe('');
  });

  // e2e companion-repo: right after the lane's view closed, its folders were still held for a
  // moment, and on Windows the removal failed "Permission denied" and kept the companion.
  it.runIf(process.platform === 'win32')(
    'deletes the lane and its companion once a brief hold on the companion lets go',
    async () => {
      const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], {
        cwd: companionPath,
        stdio: 'ignore',
      });
      await new Promise((resolve) => holder.once('spawn', resolve));

      const result = await deleteWorktree('lane-c');

      expect(result.success).toBe(true);
      expect(existsSync(companionPath)).toBe(false);
      expect(await companionWorktrees()).not.toContain('pool/c');
    }
  );

  it('deletes with its companion worktree', async () => {
    const result = await deleteWorktree('lane-c');

    expect(result.success).toBe(true);
    expect(existsSync(lane)).toBe(false);
    expect(existsSync(companionPath)).toBe(false);
    expect(readLaneRow('lane-c')).toBeUndefined();
  });

  it('refuses to delete the work item while a companion holds ignored files, then deletes both', async () => {
    writeFileSync(path.join(companionRepo, '.git', 'info', 'exclude'), '.env\n');
    writeFileSync(path.join(companionPath, '.env'), 'TOKEN=local\n');

    const refused = await deleteWorkItem('item-c');
    expect(refused).toMatchObject({ success: false, error: { type: 'companion_has_changes' } });
    expect(existsSync(lane)).toBe(true);
    expect(readLaneRow('lane-c')).toBeDefined();

    await git(['clean', '-fdX', '--', '.env'], companionPath);
    const deleted = await deleteWorkItem('item-c');
    expect(deleted.success).toBe(true);
    expect(existsSync(companionPath)).toBe(false);
    expect(existsSync(lane)).toBe(false);
  });
});
