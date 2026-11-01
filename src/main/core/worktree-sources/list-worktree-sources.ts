import { existsSync } from 'node:fs';
import { isNull } from 'drizzle-orm';
import {
  WORKTREE_SOURCE_IDS,
  type RepoWorktreeSources,
  type RepoWorktreeSourcesFailure,
  type WorktreeSourceSettings,
} from '@shared/worktree-sources';
import { readJustMeSettings } from '@main/core/repo-config/resolve-repo-config';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { discoverRepoWorktrees } from './discover-repo-worktrees';

/** The user's worktree sources, with this repository's just-me override per source. */
async function resolveRepoWorktreeSources(
  repoId: string
): Promise<{ sources: WorktreeSourceSettings; hideReview: boolean }> {
  const user = await appSettingsService.get('worktreeSources');
  const justMe = readJustMeSettings(repoId);
  const sources = Object.fromEntries(
    WORKTREE_SOURCE_IDS.map((id) => [id, justMe.worktreeSources?.[id] ?? user[id]])
  ) as WorktreeSourceSettings;
  return { sources, hideReview: justMe.hideWorktreeReview === true };
}

/**
 * A repository's discovered checkouts as the left rail shows them (plan
 * §Phase 3 slice 6): shown sources listed with Adopt, hidden ones for the one
 * "Review N worktrees" line — none after "Hide for this repo".
 */
export async function listRepoWorktreeSources(repoId: string): Promise<RepoWorktreeSources> {
  const [found, { sources, hideReview }] = await Promise.all([
    discoverRepoWorktrees(repoId),
    resolveRepoWorktreeSources(repoId),
  ]);
  const listed = found.filter((worktree) => sources[worktree.source] === 'show');
  const review = hideReview ? [] : found.filter((worktree) => sources[worktree.source] === 'hide');
  return { repoId, listed, review };
}

/**
 * Every registered repository's discovered checkouts, for the left rail —
 * including repositories with no work items yet. A repository whose
 * worktrees cannot be read is named with why; the others still list.
 */
export async function listAllRepoWorktreeSources(): Promise<{
  repos: RepoWorktreeSources[];
  failures: RepoWorktreeSourcesFailure[];
}> {
  const registered = db
    .select({ id: repos.id, path: repos.path })
    .from(repos)
    .where(isNull(repos.archivedAt))
    .all();
  const settled = await Promise.allSettled(
    registered.map((repo) => listRepoWorktreeSources(repo.id))
  );
  const listed: RepoWorktreeSources[] = [];
  const failures: RepoWorktreeSourcesFailure[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      listed.push(outcome.value);
      return;
    }
    const message =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    log.warn('[worktree-sources] could not read a repository’s worktrees', {
      repoId: registered[index].id,
      error: message,
    });
    failures.push({
      repoId: registered[index].id,
      message,
      folderMissing: !existsSync(registered[index].path),
    });
  });
  return { repos: listed, failures };
}
