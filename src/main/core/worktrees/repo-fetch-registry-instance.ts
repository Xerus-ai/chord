import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { RepoFetchRegistry } from './repo-fetch-registry';

/**
 * The real `GitFetchService` construction, split out of `repo-fetch-registry.ts`
 * because it transitively reaches `@main/db/client` (via
 * `githubConnectionService`), which needs a real Electron `app` at import
 * time — `repo-fetch-registry.test.ts` exercises `RepoFetchRegistry` itself
 * with fakes and must not pull this in.
 */
function createGitFetchService(mainRepoPath: string): GitFetchService {
  const fs = new LocalFileSystem(mainRepoPath);
  const baseCtx = new LocalExecutionContext({ root: mainRepoPath });
  const authCtx = new GitHubAuthExecutionContext(baseCtx, () => githubConnectionService.getToken());
  const git = new GitService(baseCtx, authCtx, fs);
  return new GitFetchService(git, async () => (await githubConnectionService.getToken()) !== null);
}

export const repoFetchRegistry = new RepoFetchRegistry<GitFetchService>(createGitFetchService);
