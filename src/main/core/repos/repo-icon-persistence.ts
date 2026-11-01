import { eq } from 'drizzle-orm';
import { repoIconDetectedChannel } from '@shared/events/repoEvents';
import type { RepoIconDetectionOutcome } from '@shared/repo-icon-detection';
import { serializeRepoIcon } from '@shared/repo-icons';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { detectRepoIcon } from './detect-repo-icon';

/**
 * Turns a detection outcome into the one write it is allowed to make.
 *
 * `found` stores the icon. `none` stores `{ type: 'letter' }`, which is what
 * stops the repo being probed on every launch forever. `failed` stores NOTHING
 * and is logged with the repo id: the column stays NULL so the next launch
 * retries, because a dropped connection is not evidence that a repository has
 * no icon.
 */
export async function persistRepoIconDetectionOutcome(
  repoId: string,
  outcome: RepoIconDetectionOutcome
): Promise<void> {
  if (outcome.kind === 'failed') {
    log.warn('Repo icon detection could not complete; leaving it owed', {
      repoId,
      error: outcome.error,
    });
    return;
  }

  const icon = outcome.kind === 'found' ? outcome.icon : { type: 'letter' as const };
  await db
    .update(repos)
    .set({ icon: serializeRepoIcon(icon) })
    .where(eq(repos.id, repoId));
  events.emit(repoIconDetectedChannel, { repoId });
}

/**
 * Detects and persists for one repo. Returns the outcome so a caller that has a
 * user waiting on it (`repos.detectIcon`) can say what happened; the add-repo
 * path ignores it and only wants the write and the event.
 */
export async function detectAndPersistRepoIcon(
  repoId: string,
  repoPath: string
): Promise<RepoIconDetectionOutcome> {
  const outcome = await detectRepoIcon({ repoPath });
  await persistRepoIconDetectionOutcome(repoId, outcome);
  return outcome;
}

/**
 * Kicks detection off for a freshly added repo WITHOUT making the add wait on
 * it: the probe can reach the network, and adding a repository has to stay
 * instant. The renderer learns about the icon through
 * `repoIconDetectedChannel`.
 */
export function startRepoIconDetection(repoId: string, repoPath: string): void {
  void detectAndPersistRepoIcon(repoId, repoPath).catch((error: unknown) => {
    log.error('Repo icon detection threw', { repoId, error: String(error) });
  });
}
