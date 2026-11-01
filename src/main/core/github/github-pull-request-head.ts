import type { Octokit } from '@octokit/rest';
import { err, ok, type Result } from '@shared/result';
import type {
  PullRequestHead,
  PullRequestHeadError,
  PullRequestRef,
} from '@shared/work-item-ticket';
import { describeGitHubFailure, readGitHubStatus } from './github-issue-lookup';

/**
 * Resolves a pasted PR to everything `gh pr checkout` needs: its head branch,
 * whether it lives in a fork, whether that fork accepts maintainer pushes,
 * and whether the fork still exists (a deleted fork still checks out through
 * origin's `refs/pull/<n>/head`). Read from the owner/repo the URL names.
 */
export async function getGitHubPullRequestHead(
  octokit: Octokit | null,
  ref: PullRequestRef
): Promise<Result<PullRequestHead, PullRequestHeadError>> {
  if (!octokit) {
    return err({ type: 'not_connected', message: 'GitHub is not connected.' });
  }
  try {
    const { data } = await octokit.rest.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
    });
    const headRef = data.head.ref;
    // gh refuses these too: git would read the branch name as an option.
    if (headRef.startsWith('-')) {
      return err({ type: 'error', message: `Invalid head branch name: "${headRef}"` });
    }
    const headRepo = data.head.repo;
    return ok({
      number: data.number,
      title: data.title,
      url: data.html_url,
      headRef,
      headOwner: headRepo?.owner.login ?? data.head.user?.login ?? '',
      headRepo: headRepo?.full_name ?? null,
      headCloneUrl: headRepo?.clone_url ?? null,
      crossRepository: headRepo?.full_name !== data.base.repo.full_name,
      maintainerCanModify: headRepo !== null && data.maintainer_can_modify === true,
    });
  } catch (error) {
    const status = readGitHubStatus(error);
    const message = describeGitHubFailure(error);
    if (status === 401) return err({ type: 'not_connected', message });
    if (status === 404) {
      return err({
        type: 'not_found',
        message: `${ref.owner}/${ref.repo} has no pull request #${ref.number}.`,
      });
    }
    return err({ type: 'error', message });
  }
}
