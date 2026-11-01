import type { Octokit } from '@octokit/rest';
import type { ListPullRequestPicksError, PullRequestPick } from '@shared/create-from';
import { parseGitHubRepository } from '@shared/github-repository';
import { err, type Result } from '@shared/result';
import { listGitHubPullRequests } from '@main/core/github/github-pull-request-list';
import { readRepoGitHubRepository } from './repo-github-repository';

/**
 * The PRs tab for a registered repository: the open pull requests of its
 * GitHub remote. A repository with no GitHub remote has none to pick, and is
 * told so without asking GitHub.
 */
export async function listRepoPullRequests(
  args: { repoId: string; searchTerm?: string },
  readOctokit: () => Promise<Octokit | null>
): Promise<Result<PullRequestPick[], ListPullRequestPicksError>> {
  const source = await readRepoGitHubRepository(args.repoId);
  if (!source.success) return source;
  const repository = parseGitHubRepository(source.data.repositoryUrl);
  if (!repository) {
    return err({
      type: 'no_github_remote',
      message: 'No remote of this repository is on GitHub.',
    });
  }
  return listGitHubPullRequests(await readOctokit(), repository, {
    searchTerm: args.searchTerm,
  });
}
