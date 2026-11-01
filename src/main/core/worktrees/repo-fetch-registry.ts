import type { GitFetchService } from '@main/core/git/git-fetch-service';

/** The subset of `GitFetchService` the registry needs — lets tests pass a plain object. */
export type FetchLifecycle = Pick<GitFetchService, 'start' | 'stop'>;

/**
 * One background `GitFetchService` per repository, refcounted across every
 * worktree of that repo, instead of one per worktree. `GitFetchService`
 * fetches immediately on `start()` and then every two minutes; without this,
 * acquiring N worktrees of the same repo (e.g. on app boot) would fan out N
 * concurrent fetches against the same remote and shared object store, every
 * two minutes, forever.
 *
 * Deliberately independent of `WorkspaceRegistry`: worktrees are refcounted
 * per worktree id there, but the fetch service needs to be refcounted per
 * repository, a different key with a different lifetime.
 *
 * The concrete `GitFetchService` construction lives in
 * `repo-fetch-registry-instance.ts`, not here, so this module stays free of
 * Electron-main imports (`@main/db/client` transitively, via
 * `githubConnectionService`) and can be unit-tested under plain Node.
 */
export class RepoFetchRegistry<T extends FetchLifecycle = FetchLifecycle> {
  private readonly entries = new Map<string, { service: T; refCount: number }>();

  constructor(private readonly createService: (mainRepoPath: string) => T) {}

  /** Starts the shared fetch service on the first acquire for `projectId`; later acquires just bump the refcount. */
  acquire(projectId: string, mainRepoPath: string): T {
    const existing = this.entries.get(projectId);
    if (existing) {
      existing.refCount += 1;
      return existing.service;
    }

    const service = this.createService(mainRepoPath);
    service.start();
    this.entries.set(projectId, { service, refCount: 1 });
    return service;
  }

  /** Stops the shared fetch service once the last worktree of `projectId` releases it. */
  release(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;

    if (entry.refCount > 1) {
      entry.refCount -= 1;
      return;
    }

    this.entries.delete(projectId);
    entry.service.stop();
  }

  refCount(projectId: string): number {
    return this.entries.get(projectId)?.refCount ?? 0;
  }
}
