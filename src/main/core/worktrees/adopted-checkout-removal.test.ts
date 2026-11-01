import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * An adopted checkout is the user's (plan §Phase 3 slice 6, "Decisions for
 * Phase 3"): removing its work item or its lane removes Chord's rows and
 * stops its sessions, and releases the checkpoint refs Chord wrote — but the
 * folder, its files, its branch and git's worktree list stay exactly as they
 * were. The guard keys on `checkout_origin`: the folder is a linked worktree,
 * so "is it linked" alone would remove it. Real repositories, the real
 * schema, the real delete/archive paths.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const {
  addWorktree,
  claudeWorktreePath,
  createScratchRepo,
  git,
  listGitWorktrees,
  readCheckoutState,
} = await import('@main/core/worktree-sources/_testing/scratch-worktrees');
const { db } = await import('@main/db/client');
const { agentSessions, repos, workItems, workItemWorktrees } = await import(
  '@main/db/schema-work-items'
);
const { checkpoints } = await import('@main/db/schema-checkpoints');
const { syncQueue } = await import('@main/db/schema-sync');
const { captureTurnCheckpoint } = await import('@main/core/checkpoints/checkpoint-service');
const { deleteWorkItem } = await import('@main/core/work-items/work-item-crud');
const { deleteWorktree } = await import('./delete-worktree');
const { archiveWorktree } = await import('./archive-worktree');

const REPO_ID = 'repo-1';
const ITEM_ID = 'item-1';
const CHORD_LANE = 'lane-chord';
const ADOPTED_LANE = 'lane-adopted';
const scratch = createScratchRepo('chord-adopted-removal-');
let run = 0;
let adopted: string;
let adoptedBranch: string;

afterAll(() => {
  removeDirSync(scratch.root);
});

/** A Claude Code worktree with the user's own uncommitted, untracked and ignored files in it. */
function createUserCheckout(): void {
  run += 1;
  adoptedBranch = `claude/x-${run}`;
  adopted = addWorktree(scratch.repo, claudeWorktreePath(scratch.repo, `x-${run}`), adoptedBranch);
  writeFileSync(path.join(adopted, '.env'), 'FROM=worktree\n');
  writeFileSync(path.join(adopted, 'README.md'), '# scratch\nedited outside Chord\n');
  writeFileSync(path.join(adopted, 'notes.txt'), 'mine\n');
}

function insertLane(
  id: string,
  folder: string,
  branchName: string,
  isPrimary: boolean,
  origin: 'chord' | 'adopted'
) {
  db.insert(workItemWorktrees)
    .values({
      id,
      workItemId: ITEM_ID,
      path: folder,
      branchName,
      isPrimary: isPrimary ? 1 : 0,
      targetRef: 'origin/main',
      setupStatus: origin === 'adopted' ? 'skipped' : 'ok',
      checkoutOrigin: origin,
    })
    .run();
}

async function checkpointLane(laneId: string, folder: string) {
  const row = await captureTurnCheckpoint({
    workItemId: ITEM_ID,
    turnId: `turn-${laneId}`,
    sessionId: `s-${laneId}`,
    repoPath: folder,
    worktreeId: laneId,
  });
  if (!row) throw new Error('no checkpoint was written');
  return row.gitRef;
}

const refExists = (ref: string) =>
  git(scratch.repo, 'for-each-ref', '--format=%(refname)', ref) === ref;

beforeEach(async () => {
  await db.delete(syncQueue);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: REPO_ID, path: scratch.repo, alias: 'repo' });
  createUserCheckout();
});

describe('deleting the work item of an adopted checkout', () => {
  beforeEach(async () => {
    await db.insert(workItems).values({
      id: ITEM_ID,
      name: 'Adopted',
      repoId: REPO_ID,
      repoPath: adopted,
      branchName: adoptedBranch,
      provisionStatus: 'ready',
    });
    insertLane(ADOPTED_LANE, adopted, adoptedBranch, true, 'adopted');
    await db.insert(agentSessions).values({
      id: `s-${ADOPTED_LANE}`,
      workItemId: ITEM_ID,
      kind: 'chat',
      worktreeId: ADOPTED_LANE,
      status: 'suspended',
    });
  });

  it('removes the rows and releases the checkpoint refs, and leaves the folder, branch and worktree list', async () => {
    const ref = await checkpointLane(ADOPTED_LANE, adopted);
    expect(refExists(ref)).toBe(true);
    const before = readCheckoutState(adopted);
    const worktreesBefore = listGitWorktrees(scratch.repo);

    expect(await deleteWorkItem(ITEM_ID)).toEqual({ success: true, data: undefined });

    expect(existsSync(adopted)).toBe(true);
    expect(readCheckoutState(adopted)).toEqual(before);
    expect(listGitWorktrees(scratch.repo)).toBe(worktreesBefore);
    expect(git(scratch.repo, 'branch', '--list', adoptedBranch)).toContain(adoptedBranch);
    expect(refExists(ref)).toBe(false);
    expect(db.select().from(workItems).all()).toEqual([]);
    expect(db.select().from(workItemWorktrees).all()).toEqual([]);
    expect(db.select().from(agentSessions).all()).toEqual([]);
    expect(db.select().from(checkpoints).all()).toEqual([]);
    expect(
      db
        .select()
        .from(syncQueue)
        .where(and(eq(syncQueue.entityId, ITEM_ID), eq(syncQueue.operation, 'delete')))
        .all()
    ).toHaveLength(1);
  });
});

describe('an adopted checkout as a secondary lane', () => {
  let chordLane: string;

  beforeEach(async () => {
    chordLane = addWorktree(
      scratch.repo,
      path.join(scratch.root, 'pool', `item-${run}`),
      `chord/item-${run}`
    );
    await db.insert(workItems).values({
      id: ITEM_ID,
      name: 'Two lanes',
      repoId: REPO_ID,
      repoPath: chordLane,
      branchName: `chord/item-${run}`,
      provisionStatus: 'ready',
    });
    insertLane(CHORD_LANE, chordLane, `chord/item-${run}`, true, 'chord');
    insertLane(ADOPTED_LANE, adopted, adoptedBranch, false, 'adopted');
  });

  it('Delete removes the lane and its rows, releases its refs, and leaves the folder', async () => {
    const ref = await checkpointLane(ADOPTED_LANE, adopted);
    const before = readCheckoutState(adopted);
    const worktreesBefore = listGitWorktrees(scratch.repo);

    expect(await deleteWorktree(ADOPTED_LANE)).toEqual({
      success: true,
      data: { workItemId: ITEM_ID },
    });

    expect(existsSync(adopted)).toBe(true);
    expect(readCheckoutState(adopted)).toEqual(before);
    expect(listGitWorktrees(scratch.repo)).toBe(worktreesBefore);
    expect(refExists(ref)).toBe(false);
    expect(
      db.select().from(workItemWorktrees).where(eq(workItemWorktrees.id, ADOPTED_LANE)).all()
    ).toEqual([]);
  });

  it('Archive marks the lane archived and leaves the folder', async () => {
    const before = readCheckoutState(adopted);
    const worktreesBefore = listGitWorktrees(scratch.repo);

    const result = await archiveWorktree(ADOPTED_LANE);

    expect(result.success).toBe(true);
    expect(existsSync(adopted)).toBe(true);
    expect(readCheckoutState(adopted)).toEqual(before);
    expect(listGitWorktrees(scratch.repo)).toBe(worktreesBefore);
    const [lane] = db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.id, ADOPTED_LANE))
      .all();
    expect(lane.archivedAt).not.toBeNull();
  });
});
