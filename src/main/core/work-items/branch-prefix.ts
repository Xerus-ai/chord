import type { AppSettings } from '@shared/app-settings';
import { err, ok, type Result } from '@shared/result';

/**
 * The prefix a new chord-named branch gets (Settings › Git), decided from the
 * user's choice alone. Pure: GitHub is reached only through `readGitHubLogin`,
 * and only in username mode before a login has been stored — the plan's
 * "resolved once from GitHub and stored". Storing is the caller's
 * (`resolve-branch-prefix.ts`), so this is tested without settings or network.
 */

export type BranchPrefixSettings = Pick<
  AppSettings['localProject'],
  'branchPrefixMode' | 'branchPrefix' | 'branchPrefixUsername'
>;

export type BranchPrefixError = { type: 'branch_prefix_unavailable'; message: string };

export interface PickedBranchPrefix {
  prefix: string;
  /** A login looked up just now, for the caller to store; null when nothing was looked up. */
  learnedUsername: string | null;
}

export async function pickBranchPrefix(
  settings: BranchPrefixSettings,
  readGitHubLogin: () => Promise<string | null>
): Promise<Result<PickedBranchPrefix, BranchPrefixError>> {
  switch (settings.branchPrefixMode) {
    case 'none':
      return ok({ prefix: '', learnedUsername: null });
    case 'custom':
      return ok({ prefix: settings.branchPrefix, learnedUsername: null });
    case 'username': {
      if (settings.branchPrefixUsername) {
        return ok({ prefix: settings.branchPrefixUsername, learnedUsername: null });
      }
      const login = await readGitHubLogin();
      if (!login) {
        return err({
          type: 'branch_prefix_unavailable',
          message:
            "New branches are named after your GitHub username, and GitHub isn't connected. Connect it in Settings › Integrations, or choose another branch prefix in Settings › Git.",
        });
      }
      return ok({ prefix: login, learnedUsername: login });
    }
  }
}
