import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { pullRequests } from '@main/db/schema';
import { syncQueue } from '@main/db/schema-sync';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { promoteWorktreeToPrimary } from './service';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const REPO_URL = 'https://github.com/acme/chord';
const ITEM = 'item-1';
const LANE_A = 'lane-a';
const LANE_B = 'lane-b';
const LANE_C = 'lane-c';
const PR_A = `${REPO_URL}/pull/7`;
const PR_B = `${REPO_URL}/pull/12`;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

let root: string;
let checkouts: Record<string, string>;

/** A GitHub-origin repository with two more lanes checked out beside it. */
async function createLaneCheckouts(): Promise<Record<string, string>> {
  const main = path.join(root, 'chord');
  fs.mkdirSync(main);
  await git(['init', '-q', '-b', 'raghav/login'], main);
  await git(['config', 'user.email', 'test@chord.invalid'], main);
  await git(['config', 'user.name', 'Chord test'], main);
  fs.writeFileSync(path.join(main, 'README.md'), '# chord\n');
  await git(['add', 'README.md'], main);
  await git(['commit', '-q', '-m', 'readme'], main);
  await git(['remote', 'add', 'origin', `${REPO_URL}.git`], main);
  const laneB = path.join(root, 'lane-b');
  const laneC = path.join(root, 'lane-c');
  await git(['worktree', 'add', '-q', '-b', 'raghav/login--api', laneB], main);
  await git(['worktree', 'add', '-q', '-b', 'raghav/login--docs', laneC], main);
  return { [LANE_A]: main, [LANE_B]: laneB, [LANE_C]: laneC };
}

function insertPr(url: string, number: number, headRefName: string): void {
  db.insert(pullRequests)
    .values({
      url,
      repositoryUrl: REPO_URL,
      baseRefName: 'main',
      baseRefOid: 'c'.repeat(40),
      headRepositoryUrl: REPO_URL,
      headRefName,
      headRefOid: 'a'.repeat(40),
      identifier: `#${number}`,
      title: `PR ${number}`,
      status: 'open',
      isDraft: 0,
    })
    .run();
}

function readMirror(): { prNumber: number | null; prUrl: string | null } {
  const [row] = db
    .select({ prNumber: workItems.prNumber, prUrl: workItems.prUrl })
    .from(workItems)
    .where(eq(workItems.id, ITEM))
    .all();
  return row;
}

/** What the next cloud PATCH for the work item carries. */
function readQueuedPatch(): Record<string, unknown> {
  const [row] = db
    .select({ payload: syncQueue.payload })
    .from(syncQueue)
    .where(
      and(
        eq(syncQueue.entityType, 'work_item'),
        eq(syncQueue.entityId, ITEM),
        eq(syncQueue.operation, 'update')
      )
    )
    .all();
  if (!row) throw new Error('no cloud update was queued for the work item');
  return JSON.parse(row.payload) as Record<string, unknown>;
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-promote-pr-'));
  checkouts = await createLaneCheckouts();
  // The primary's PR is already mirrored on the work item, as Create PR leaves it.
  db.insert(workItems)
    .values({
      id: ITEM,
      name: 'Login',
      repoPath: checkouts[LANE_A],
      branchName: 'raghav/login',
      provisionStatus: 'ready',
      prNumber: 7,
      prUrl: PR_A,
    })
    .run();
  db.insert(workItemWorktrees)
    .values([
      {
        id: LANE_A,
        workItemId: ITEM,
        path: checkouts[LANE_A],
        branchName: 'raghav/login',
        isPrimary: 1,
        targetRef: 'origin/main',
      },
      {
        id: LANE_B,
        workItemId: ITEM,
        path: checkouts[LANE_B],
        branchName: 'raghav/login--api',
        isPrimary: 0,
        targetRef: 'origin/main',
      },
      {
        id: LANE_C,
        workItemId: ITEM,
        path: checkouts[LANE_C],
        branchName: 'raghav/login--docs',
        isPrimary: 0,
        targetRef: 'origin/main',
      },
    ])
    .run();
  insertPr(PR_A, 7, 'raghav/login');
  insertPr(PR_B, 12, 'raghav/login--api');
});

afterEach(() => {
  db.delete(syncQueue).run();
  db.delete(pullRequests).run();
  db.delete(workItems).run();
  removeDirSync(root);
});

describe("promote moves work_items.pr_* to the new primary lane's PR", () => {
  it("mirrors the promoted lane's PR locally and in the cloud update", async () => {
    const promoted = await promoteWorktreeToPrimary(LANE_B);

    expect(promoted.success).toBe(true);
    expect(readMirror()).toEqual({ prNumber: 12, prUrl: PR_B });
    expect(readQueuedPatch()).toMatchObject({
      branch_name: 'raghav/login--api',
      pr_number: 12,
      pr_url: PR_B,
    });
  });

  it('clears the mirror when the promoted lane has no PR', async () => {
    const promoted = await promoteWorktreeToPrimary(LANE_C);

    expect(promoted.success).toBe(true);
    expect(readMirror()).toEqual({ prNumber: null, prUrl: null });
    expect(readQueuedPatch()).toMatchObject({
      branch_name: 'raghav/login--docs',
      pr_number: null,
      pr_url: null,
    });
  });

  it('follows the primary back: promoting the first lane again restores its PR', async () => {
    await promoteWorktreeToPrimary(LANE_B);
    expect(readMirror()).toEqual({ prNumber: 12, prUrl: PR_B });

    await promoteWorktreeToPrimary(LANE_A);
    expect(readMirror()).toEqual({ prNumber: 7, prUrl: PR_A });
  });

  it('leaves the mirror alone when the lane is already the primary', async () => {
    await promoteWorktreeToPrimary(LANE_A);

    expect(readMirror()).toEqual({ prNumber: 7, prUrl: PR_A });
  });
});
