import { err, ok, type Result } from '@shared/result';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { pickBranchPrefix, type BranchPrefixError } from './branch-prefix';

/**
 * The prefix for a branch being created now: `pickBranchPrefix` on the stored
 * choice, storing a login the first time username mode looks one up so later
 * branches — and offline creates — never ask GitHub again.
 */
export async function resolveBranchPrefix(): Promise<Result<string, BranchPrefixError>> {
  const settings = await appSettingsService.get('localProject');
  let unreachable: string | null = null;
  const picked = await pickBranchPrefix(settings, async () => {
    try {
      return (await githubConnectionService.getCurrentUser())?.login ?? null;
    } catch (error) {
      // Connected, but GitHub didn't answer: refused below with the cause, not
      // reported as "not connected".
      unreachable = error instanceof Error ? error.message : String(error);
      return null;
    }
  });
  if (unreachable !== null) {
    return err({
      type: 'branch_prefix_unavailable',
      message: `New branches are named after your GitHub username, and GitHub couldn't be reached to look it up (${unreachable}). Try again, or choose another branch prefix in Settings › Git.`,
    });
  }
  if (!picked.success) return picked;

  const { prefix, learnedUsername } = picked.data;
  if (learnedUsername) {
    await appSettingsService.update('localProject', {
      ...settings,
      branchPrefixUsername: learnedUsername,
    });
  }
  return ok(prefix);
}
