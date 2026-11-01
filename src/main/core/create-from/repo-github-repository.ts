import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import { readCheckoutRemotes } from '@main/core/pull-requests/checkout-remotes';
import { db } from '@main/db/client';
import { repos, type RepoRow } from '@main/db/schema-work-items';

export type RepoNotFound = { type: 'no_repo'; message: string };

export async function readRepoRow(repoId: string): Promise<Result<RepoRow, RepoNotFound>> {
  const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
  if (!repo) return err({ type: 'no_repo', message: `Repository ${repoId} was not found.` });
  return ok(repo);
}

/**
 * The GitHub repository a registered repository's PRs and issues come from:
 * the GitHub remote of its checkout, `origin` first, then any other
 * (`readCheckoutRemotes`). Null when no remote is on GitHub.
 */
export async function readRepoGitHubRepository(
  repoId: string
): Promise<Result<{ repositoryUrl: string | null }, RepoNotFound>> {
  const repo = await readRepoRow(repoId);
  if (!repo.success) return repo;
  const { repositoryUrl } = await readCheckoutRemotes(repo.data.path);
  return ok({ repositoryUrl });
}
