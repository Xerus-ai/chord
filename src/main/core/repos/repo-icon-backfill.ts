import { and, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import type { IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { detectAndPersistRepoIcon } from './repo-icon-persistence';

/**
 * Gives an icon to every repo that was attached before detection existed, and
 * retries the ones whose last probe could not complete.
 *
 * `icon IS NULL` is the whole queue, and it drains itself: a repo that finds an
 * icon stores it, and one that finds nothing stores `{ type: 'letter' }`. Only
 * a `failed` probe stays NULL, so the retry is bounded by how often a repo's
 * probe keeps failing rather than by a counter.
 *
 * Archived repos are skipped: they are hidden from every picker and the
 * sidebar, so probing them spends network on a tile nobody will see.
 *
 * Sequential on purpose. A user with thirty GitHub repos would otherwise open
 * thirty simultaneous requests to github.com the moment the app starts, which
 * is how an install earns a rate limit on the path that also serves PR sync.
 */
export class RepoIconBackfill implements IInitializable {
  private running = false;

  /** Not awaited by the caller: this is background work behind the window. */
  initialize(): void {
    void this.run().catch((error: unknown) => {
      log.error('Repo icon backfill failed', { error: String(error) });
    });
  }

  private async run(): Promise<void> {
    // A second pass while the first is still walking would double the requests
    // the sequential loop exists to avoid.
    if (this.running) return;
    this.running = true;

    try {
      const pending = await db
        .select({ id: repos.id, path: repos.path })
        .from(repos)
        .where(and(isNull(repos.icon), isNull(repos.archivedAt)));

      if (pending.length === 0) return;
      log.info('Detecting icons for repos that have never been probed', {
        count: pending.length,
      });

      for (const repo of pending) {
        // One repo's probe throwing must not strand the rest of the queue.
        try {
          await detectAndPersistRepoIcon(repo.id, repo.path);
        } catch (error) {
          log.warn('Repo icon detection threw during backfill', {
            repoId: repo.id,
            error: String(error),
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const repoIconBackfill = new RepoIconBackfill();
