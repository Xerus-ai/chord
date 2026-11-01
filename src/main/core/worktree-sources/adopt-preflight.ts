import { existsSync } from 'node:fs';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { AdoptWorktreeError } from '@shared/worktree-sources';
import { comparablePath } from '@main/core/utils/comparable-path';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees, type RepoRow } from '@main/db/schema-work-items';
import { readAdoptableEntries, readHeldLanePaths } from './discover-repo-worktrees';
import type { GitWorktreeEntry } from './git-worktree-list';

/** The adoptable checkout at `folder`, or `not_a_worktree` (gone, unregistered, or the repository's own). */
export async function findAdoptableEntry(
  repo: RepoRow,
  folder: string
): Promise<Result<GitWorktreeEntry, { type: 'not_a_worktree'; path: string }>> {
  const target = comparablePath(folder);
  const entry = (await readAdoptableEntries(repo)).find(
    (candidate) => comparablePath(candidate.path) === target
  );
  if (!entry) return err({ type: 'not_a_worktree' as const, path: path.resolve(folder) });
  return ok(entry);
}

/** A lane of this repository holding `branch` whose folder was removed outside git. */
function findStaleLane(repoId: string, branch: string): { id: string; path: string } | null {
  const lanes = db
    .select({ id: workItemWorktrees.id, path: workItemWorktrees.path })
    .from(workItemWorktrees)
    .innerJoin(workItems, eq(workItems.id, workItemWorktrees.workItemId))
    .where(
      and(
        eq(workItems.repoId, repoId),
        eq(workItemWorktrees.branchName, branch),
        isNull(workItemWorktrees.archivedAt)
      )
    )
    .all();
  return lanes.find((lane) => !existsSync(lane.path)) ?? null;
}

/**
 * What Adopt checks before anything is written (plan §Phase 3 slice 6): the
 * folder is one of the repository's worktrees, no lane holds it, it is on a
 * branch, and no lane whose folder is gone holds that branch.
 */
export async function preflightAdoption(
  repo: RepoRow,
  folder: string
): Promise<Result<GitWorktreeEntry & { branch: string }, AdoptWorktreeError>> {
  const found = await findAdoptableEntry(repo, folder);
  if (!found.success) return found;
  const entry = found.data;

  const holder = readHeldLanePaths().get(comparablePath(entry.path));
  if (holder) return err({ type: 'already_adopted' as const, laneId: holder });

  const { branch } = entry;
  if (branch === null) return err({ type: 'no_branch' as const, path: entry.path });

  const stale = findStaleLane(repo.id, branch);
  if (stale) return err({ type: 'stale_lane' as const, laneId: stale.id, path: stale.path });

  return ok({ ...entry, branch });
}
