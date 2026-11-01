import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import type { RepoIconDetectionOutcome } from '@shared/repo-icon-detection';
import { getRemoteUrl, parseGitRemoteUrl } from '@main/core/issues/git-remote-resolver';
import { detectRepoIconFile } from './detect-repo-icon-file';
import { buildGitHubAvatarUrl, fetchGitHubAvatarIcon } from './detect-repo-icon-github';

/**
 * The `origin` remote's URL, or `null` when the checkout has no such remote or
 * is not a git repository at all. Either way there is no owner to ask about.
 */
async function readOriginRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    return await getRemoteUrl(repoPath, DEFAULT_REMOTE_NAME);
  } catch {
    return null;
  }
}

/**
 * Picks the sidebar icon for the repository at `repoPath`: its own icon file
 * when it has one, otherwise the avatar of the GitHub owner behind `origin`.
 * A file probe that could not read the directory ends here as `failed`, so a
 * broken checkout never reaches the network. At most one avatar is requested.
 *
 * `avatarOrigin` lets tests point the avatar fetch at a loopback server;
 * `timeoutMs` is handed to that fetch unchanged.
 */
export async function detectRepoIcon(args: {
  repoPath: string;
  avatarOrigin?: string;
  timeoutMs?: number;
}): Promise<RepoIconDetectionOutcome> {
  const fileOutcome = await detectRepoIconFile(args.repoPath);
  if (fileOutcome.kind !== 'none') return fileOutcome;

  const remoteUrl = await readOriginRemoteUrl(args.repoPath);
  if (!remoteUrl) return { kind: 'none' };

  const remote = parseGitRemoteUrl(remoteUrl);
  if (!remote) return { kind: 'none' };

  const avatarUrl = buildGitHubAvatarUrl(remote, args.avatarOrigin);
  if (!avatarUrl) return { kind: 'none' };

  return fetchGitHubAvatarIcon(avatarUrl, { timeoutMs: args.timeoutMs });
}
