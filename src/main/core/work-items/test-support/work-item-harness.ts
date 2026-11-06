import fs from 'node:fs';
import path from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { expect, vi } from 'vitest';
import { signInTestAccount } from '@main/core/account/_testing/test-account';
import {
  copyGitRemoteFixture,
  createGitRemoteTemplate,
  git,
  removeGitFixture,
  type GitRemoteFixture,
} from '@main/core/git/_testing/git-remote-fixture';
import { appSettingsService } from '@main/core/settings/settings-service';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { syncQueue } from '@main/db/schema-sync';
import {
  repos,
  workItems,
  workItemTickets,
  workItemWorktrees,
  type WorkItemRow,
  type WorkItemWorktreeRow,
} from '@main/db/schema-work-items';
import { resolveLanePoolPath } from '../lane-pool-path';

/**
 * The real stack the work-item suites create items on (devstation-i3y5.6):
 * a clone of a bare origin (`git/_testing/git-remote-fixture.ts`, built once
 * per suite and copied per test), the worktree root and branch prefix written
 * through the real settings service, a Chord account signed in through the
 * real account path, and readers for what createWorkItem leaves behind — the
 * rows, the primary lane, the queued sync operations. Provisioning, preflight,
 * lane setup, the workspace registry and the sync queue all run for real.
 *
 * A suite that uses it supplies `electron` with
 * `account/_testing/test-keychain.ts` and `@main/db/client` with
 * `db/_testing/migrated-test-db.ts`, as the worktree suites do.
 */

export { git };

/** The account the suites sign in as: `signInTestAccount` names it `user-<username>`. */
export const OWNER_ID = 'user-test-owner';

const SETTLE_TIMEOUT_MS = 25_000;
const REMOVE_TIMEOUT_MS = 15_000;

export interface WorkItemRepo extends GitRemoteFixture {
  /** The user's repository: the clone, on `main`, `origin` the bare remote. */
  repoDir: string;
  /** Settings › General: where lane checkouts go. Created by the first checkout. */
  poolRoot: string;
}

let signedIn: Promise<void> | null = null;

/**
 * The suite's template repository; signs the account in on first use, before
 * anything reads the session (the account service loads it once per process).
 */
export async function createWorkItemTemplate(): Promise<string> {
  signedIn ??= signInTestAccount({ username: 'test-owner', email: 'owner@chord.test' });
  await signedIn;
  return createGitRemoteTemplate();
}

export function removeWorkItemTemplate(template: string): void {
  removeGitFixture(template);
}

/** A test's own repository and pool, on empty work-item tables and sync queue. */
export async function openWorkItemRepo(template: string, prefix: string): Promise<WorkItemRepo> {
  const fixture = copyGitRemoteFixture(template, prefix);
  const repo = { ...fixture, repoDir: fixture.cloneDir, poolRoot: path.join(fixture.root, 'pool') };
  db.delete(workItems).run();
  db.delete(repos).run();
  db.delete(syncQueue).run();
  const localProject = await appSettingsService.get('localProject');
  await appSettingsService.update('localProject', {
    ...localProject,
    defaultWorktreeDirectory: repo.poolRoot,
    branchPrefixMode: 'custom',
    branchPrefix: 'chord',
  });
  return repo;
}

/**
 * Waits for every item's provisioning (and a ready item's setup) to finish,
 * releases the workspaces they acquired, then removes the repository: on
 * Windows a process still inside a checkout keeps the folder.
 */
export async function closeWorkItemRepo(repo: WorkItemRepo): Promise<void> {
  for (const { id } of db.select({ id: workItems.id }).from(workItems).all()) {
    await settleWorkItem(id);
  }
  await workspaceRegistry.releaseAll();
  await vi.waitFor(() => removeGitFixture(repo.root), { timeout: REMOVE_TIMEOUT_MS });
}

export function readWorkItem(id: string): WorkItemRow | undefined {
  return db.select().from(workItems).where(eq(workItems.id, id)).get();
}

export function primaryLane(workItemId: string): WorkItemWorktreeRow {
  const lane = db
    .select()
    .from(workItemWorktrees)
    .where(and(eq(workItemWorktrees.workItemId, workItemId), eq(workItemWorktrees.isPrimary, 1)))
    .get();
  if (!lane) throw new Error(`work item ${workItemId} has no primary lane`);
  return lane;
}

/**
 * The item once provisioning has landed or failed, and once a ready item's
 * setup has run: both happen in the background of createWorkItem and of a retry.
 */
export async function settleWorkItem(id: string): Promise<WorkItemRow> {
  let settled: WorkItemRow | undefined;
  await vi.waitFor(
    () => {
      const row = readWorkItem(id);
      if (!row) throw new Error(`work item ${id} no longer exists`);
      expect(row.provisionStatus).not.toBe('provisioning');
      if (row.provisionStatus === 'ready') {
        expect(['pending', 'running']).not.toContain(primaryLane(id).setupStatus);
      }
      settled = row;
    },
    { timeout: SETTLE_TIMEOUT_MS, interval: 50 }
  );
  return settled!;
}

/** The work-item operations queued for the cloud, oldest first, payloads parsed. */
export function queuedSync(workItemId: string): { operation: string; payload: unknown }[] {
  return db
    .select({ operation: syncQueue.operation, payload: syncQueue.payload })
    .from(syncQueue)
    .where(and(eq(syncQueue.entityType, 'work_item'), eq(syncQueue.entityId, workItemId)))
    .orderBy(asc(syncQueue.id))
    .all()
    .map((row) => ({ operation: row.operation, payload: JSON.parse(row.payload) as unknown }));
}

const TABLES = {
  work_items: workItems,
  work_item_worktrees: workItemWorktrees,
  work_item_tickets: workItemTickets,
};

export function rowCount(table: keyof typeof TABLES): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(TABLES[table])
    .get()!.n;
}

/** Where the lanes of `repo` (added by path, no alias) are checked out. */
export function lanePoolPath(repo: WorkItemRepo): string {
  return resolveLanePoolPath({
    worktreeRoot: repo.poolRoot,
    repoLabel: path.resolve(repo.repoDir),
    repoId: null,
    justMeFolder: undefined,
  });
}

/** A file where the lane pool goes: no checkout can be made until it is unblocked. */
export function blockLanePool(repo: WorkItemRepo): void {
  fs.mkdirSync(repo.poolRoot, { recursive: true });
  fs.writeFileSync(lanePoolPath(repo), 'not a folder\n');
}

export function unblockLanePool(repo: WorkItemRepo): void {
  fs.rmSync(lanePoolPath(repo));
}

/** Moves the remote away: every fetch from `origin` fails until it is restored. */
export function cutOrigin(repo: WorkItemRepo): void {
  fs.renameSync(repo.remoteDir, `${repo.remoteDir}-away`);
}

export function restoreOrigin(repo: WorkItemRepo): void {
  fs.renameSync(`${repo.remoteDir}-away`, repo.remoteDir);
}

/** A new commit on `branch`, pushed to origin from the pusher; its sha. The clone has not fetched it. */
export async function pushBranch(repo: WorkItemRepo, branch: string): Promise<string> {
  await git(['checkout', '-q', '-b', branch], repo.pusherDir);
  await git(['commit', '-q', '--allow-empty', '-m', `on ${branch}`], repo.pusherDir);
  const sha = await git(['rev-parse', 'HEAD'], repo.pusherDir);
  await git(['push', '-q', 'origin', branch], repo.pusherDir);
  await git(['checkout', '-q', 'main'], repo.pusherDir);
  return sha;
}
