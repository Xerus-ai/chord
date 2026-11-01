import { createRPCController } from '@shared/ipc/rpc';
import { readConnectedOctokit } from '@main/core/github/services/octokit-provider';
import { listBranchPicks } from './list-branch-picks';
import { listRepoPullRequests } from './list-repo-pull-requests';
import { readRepoGitHubRepository } from './repo-github-repository';

/**
 * Create from… (plan §Phase 3 slice 2), keyed by the registered repository
 * the create dialog has selected. Issues come through `issues.*` with the
 * GitHub repository read here.
 */
export const createFromController = createRPCController({
  listBranches: (repoId: string) => listBranchPicks(repoId),

  listPullRequests: (args: { repoId: string; searchTerm?: string }) =>
    listRepoPullRequests(args, readConnectedOctokit),

  readGitHubRepository: (repoId: string) => readRepoGitHubRepository(repoId),
});
