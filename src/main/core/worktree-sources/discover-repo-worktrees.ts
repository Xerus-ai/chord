import { eq } from 'drizzle-orm';
import { classifyWorktreeSource, type DiscoveredWorktree } from '@shared/worktree-sources';
import { comparablePath } from '@main/core/utils/comparable-path';
import { db } from '@main/db/client';
import { repos, workItemWorktrees, type RepoRow } from '@main/db/schema-work-items';
import { readGitWorktreeList, type GitWorktreeEntry } from './git-worktree-list';

/** The registered repository, or a throw: callers pass ids the rail just listed. */
export function readRepo(repoId: string): RepoRow {
  const [repo] = db.select().from(repos).where(eq(repos.id, repoId)).limit(1).all();
  if (!repo) throw new Error(`No repository with id ${repoId}`);
  return repo;
}

/**
 * Every folder a lane holds, keyed by `comparablePath`, to the lane holding
 * it. A lane still being created points at its repository's own folder
 * (`createWorkItem`); those rows hold nothing here — the repository's folder
 * is never offered anyway.
 */
export function readHeldLanePaths(): Map<string, string> {
  const registered = new Set(
    db
      .select({ path: repos.path })
      .from(repos)
      .all()
      .map((repo) => comparablePath(repo.path))
  );
  const held = new Map<string, string>();
  for (const lane of db
    .select({ id: workItemWorktrees.id, path: workItemWorktrees.path })
    .from(workItemWorktrees)
    .all()) {
    const key = comparablePath(lane.path);
    if (!registered.has(key)) held.set(key, lane.id);
  }
  return held;
}

/**
 * The repository's checkouts a user could adopt: git's worktrees that are on
 * disk, minus git's main checkout and the registered folder (they are the
 * user's own; the registered folder can itself be a linked worktree, P22).
 */
export async function readAdoptableEntries(repo: RepoRow): Promise<GitWorktreeEntry[]> {
  const registered = comparablePath(repo.path);
  return (await readGitWorktreeList(repo.path)).filter(
    (entry) =>
      !entry.isMain && !entry.bare && !entry.missing && comparablePath(entry.path) !== registered
  );
}

/**
 * Checkouts of a repository that Chord did not make and no lane holds (plan
 * §Phase 3 slice 6, Discovery), each with where it came from.
 */
export async function discoverRepoWorktrees(repoId: string): Promise<DiscoveredWorktree[]> {
  const repo = readRepo(repoId);
  const held = readHeldLanePaths();
  return (await readAdoptableEntries(repo))
    .filter((entry) => !held.has(comparablePath(entry.path)))
    .map((entry) => ({
      path: entry.path,
      branch: entry.branch,
      head: entry.head,
      source: classifyWorktreeSource(entry.path),
    }));
}
