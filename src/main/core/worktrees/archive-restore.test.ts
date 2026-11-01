import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Archive and Restore keep history (plan §"Decisions for Phase 5"): archive
 * snapshots the uncommitted work to `refs/chord/archive/<laneId>`, keeps the
 * checkpoints and the branch, and removes the checkout; restore recreates it
 * at its path with that work uncommitted again. A real repository and real
 * lanes; Electron's keychain and the database are the substitutes the other
 * worktree suites use.
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
const { captureTurnCheckpoint } = await import('@main/core/checkpoints/checkpoint-service');
const { addLane, createLaneRepo, git, insertRepoAndItems, readLaneRow, removeLaneRepo } =
  await import('@main/core/lane-runs/_testing/lane-run-fixture');
const { archiveWorktree } = await import('./archive-worktree');
const { restoreWorktree } = await import('./restore-worktree');
const { listArchivedLanes } = await import('./archived-lanes');
const { deleteWorktree } = await import('./delete-worktree');
const { deleteWorkItem } = await import('@main/core/work-items/work-item-crud');
const { workspaceRegistry } = await import('@main/core/workspaces/workspace-registry');
const { releaseWorktreeWorkspace } = await import('./workspace-bridge');

type LaneRepo = Awaited<ReturnType<typeof createLaneRepo>>;

let repo: LaneRepo;
let lane: string;

async function refExists(ref: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', ref], repo.repoDir);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  db.delete(checkpoints).run();
  db.delete(workItemWorktrees).run();
  db.delete(workItems).run();
  db.delete(repos).run();
  repo = await createLaneRepo('chord-archive-restore-');
  // Git for Windows sets core.autocrlf=true system-wide, so a restore would
  // write CRLF; the suite compares exact bytes.
  await git(['config', 'core.autocrlf', 'false'], repo.repoDir);
  insertRepoAndItems(repo.repoDir, ['item-a']);
  await addLane({ repo, laneId: 'lane-a', workItemId: 'item-a', dir: 'a' });
  lane = await addLane({
    repo,
    laneId: 'lane-a2',
    workItemId: 'item-a',
    dir: 'a2',
    isPrimary: false,
  });
  writeFileSync(path.join(lane, 'work.md'), 'committed\n');
  await git(['add', 'work.md'], lane);
  await git(['commit', '-m', 'work'], lane);
  // A turn's checkpoint, then uncommitted work: a tracked edit and a new file.
  writeFileSync(path.join(lane, 'work.md'), 'committed\nedited\n');
  await captureTurnCheckpoint({
    workItemId: 'item-a',
    turnId: 'turn-1',
    sessionId: null,
    repoPath: lane,
    worktreeId: 'lane-a2',
  });
  writeFileSync(path.join(lane, 'notes.md'), 'not committed yet\n');
});

afterEach(async () => {
  await removeLaneRepo(repo);
});

describe('archiveWorktree', () => {
  it('removes the checkout and keeps the branch, the uncommitted work and the checkpoints', async () => {
    const result = await archiveWorktree('lane-a2');

    expect(result.success).toBe(true);
    expect(existsSync(lane)).toBe(false);
    expect(await refExists('refs/heads/chord/a2')).toBe(true);
    expect(await refExists('refs/chord/archive/lane-a2')).toBe(true);
    const kept = db.select().from(checkpoints).where(eq(checkpoints.worktreeId, 'lane-a2')).all();
    expect(kept).toHaveLength(1);
    expect(await refExists(kept[0].gitRef as string)).toBe(true);
    expect(readLaneRow('lane-a2').archivedAt).not.toBeNull();
  });

  it('never archives the primary', async () => {
    const result = await archiveWorktree('lane-a');
    expect(result.success ? null : result.error.type).toBe('primary_worktree');
  });
});

describe('restoreWorktree', () => {
  it('recreates the checkout at its path, with the uncommitted work back and the index at HEAD', async () => {
    await archiveWorktree('lane-a2');

    const result = await restoreWorktree('lane-a2');

    expect(result.success).toBe(true);
    expect(await git(['branch', '--show-current'], lane)).toBe('chord/a2');
    expect(readFileSync(path.join(lane, 'work.md'), 'utf8')).toBe('committed\nedited\n');
    expect(readFileSync(path.join(lane, 'notes.md'), 'utf8')).toBe('not committed yet\n');
    expect(await git(['diff', '--cached', '--name-only'], lane)).toBe('');
    // The fixture's git() trims its output, so the lines are compared trimmed. Setup is still
    // reading this index; a status that rewrites it can fail setup's open on Windows
    // (devstation-jf83), so the test reads it the way the app does, without optional locks.
    const status = (await git(['--no-optional-locks', 'status', '--porcelain'], lane))
      .split('\n')
      .map((line) => line.trim());
    expect(status.sort()).toEqual(['?? notes.md', 'M work.md']);
    expect(readLaneRow('lane-a2').archivedAt).toBeNull();
    // The snapshot is in the checkout now; its ref is released.
    expect(await refExists('refs/chord/archive/lane-a2')).toBe(false);
    // Setup runs again, as for a new lane.
    await vi.waitFor(() => expect(readLaneRow('lane-a2').setupStatus).toBe('ok'), {
      timeout: 15_000,
    });
  });

  it('never shows the lane live before its workspace is there (devstation-b3d4)', async () => {
    await archiveWorktree('lane-a2');
    // Watches the lane on every turn of the event loop while Restore runs: a
    // reader that finds it un-archived must be able to read its git state.
    let liveWithoutWorkspace = false;
    let restoring = true;
    const watch = (): void => {
      if (readLaneRow('lane-a2').archivedAt === null && !workspaceRegistry.get('lane-a2')) {
        liveWithoutWorkspace = true;
      }
      if (restoring) setImmediate(watch);
    };
    setImmediate(watch);

    const result = await restoreWorktree('lane-a2');
    restoring = false;

    expect(result.success).toBe(true);
    expect(workspaceRegistry.get('lane-a2')).toBeDefined();
    expect(liveWithoutWorkspace).toBe(false);
    await vi.waitFor(() => expect(readLaneRow('lane-a2').setupStatus).toBe('ok'), {
      timeout: 15_000,
    });
    await releaseWorktreeWorkspace('lane-a2');
  });

  it('refuses a lane whose branch is gone, and leaves it archived', async () => {
    await archiveWorktree('lane-a2');
    await git(['branch', '-D', 'chord/a2'], repo.repoDir);

    const result = await restoreWorktree('lane-a2');

    expect(result.success ? null : result.error.type).toBe('branch_missing');
    expect(readLaneRow('lane-a2').archivedAt).not.toBeNull();
    expect(existsSync(lane)).toBe(false);
  });
});

describe('listArchivedLanes', () => {
  it('lists an archived lane with the changes it keeps, and whether it can be restored', async () => {
    await archiveWorktree('lane-a2');
    expect(await listArchivedLanes('item-a')).toEqual([
      expect.objectContaining({
        id: 'lane-a2',
        branchName: 'chord/a2',
        restorable: true,
        keptChanges: 2,
      }),
    ]);

    await git(['branch', '-D', 'chord/a2'], repo.repoDir);
    expect((await listArchivedLanes('item-a'))[0].restorable).toBe(false);
  });

  it('lists nothing for live lanes', async () => {
    expect(await listArchivedLanes('item-a')).toEqual([]);
  });
});

describe('deleting an archived lane', () => {
  it('releases its archive and its checkpoints', async () => {
    await archiveWorktree('lane-a2');
    const [checkpoint] = db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.worktreeId, 'lane-a2'))
      .all();

    const result = await deleteWorktree('lane-a2');

    expect(result.success).toBe(true);
    expect(await refExists('refs/chord/archive/lane-a2')).toBe(false);
    expect(await refExists(checkpoint.gitRef as string)).toBe(false);
    expect(readLaneRow('lane-a2')).toBeUndefined();
  });

  it("goes with its work item: deleting the item releases the lane's archive", async () => {
    await archiveWorktree('lane-a2');

    await deleteWorkItem('item-a');

    expect(await refExists('refs/chord/archive/lane-a2')).toBe(false);
  });
});
