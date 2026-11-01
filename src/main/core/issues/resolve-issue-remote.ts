import type { GitRepositoryService } from '@main/core/git/repository-service';
import type { IssueQueryOpts } from './issue-provider';

/**
 * An issue query by `projectId` reads the project's configured remote, and
 * passes its URL: the GitHub provider parses the repository from it
 * (`parseGitHubRepository`). The remote's name (`origin`) parses as nothing,
 * which left every project query "Repository URL is required."
 */
export async function resolveIssueQueryRemote<T extends IssueQueryOpts>(
  opts: T,
  readRepository: (projectId: string) => GitRepositoryService | undefined
): Promise<T & Pick<IssueQueryOpts, 'remote'>> {
  if (!opts.projectId) return opts;
  const repository = readRepository(opts.projectId);
  if (!repository) throw new Error(`Project ${opts.projectId} is not open.`);

  const [name, remotes] = await Promise.all([
    repository.getConfiguredRemote(),
    repository.getRemotes(),
  ]);
  return { ...opts, remote: remotes.find((remote) => remote.name === name)?.url };
}
