import { buildWorktreeBranchName } from '@shared/worktrees';

/**
 * Live preview of the branch name `rpc.worktrees.create` will actually
 * produce for a new worktree off `baseBranch`, given the title the launcher's
 * "New chat in new worktree" input currently holds. A thin wrapper around
 * `buildWorktreeBranchName` — the same function `worktrees/service.ts` calls
 * on create — so the preview can never drift from what main does; it is not
 * a second implementation of the naming rule.
 */
export function previewWorktreeBranch(
  baseBranch: string,
  title: string | undefined,
  existingBranches: string[]
): string {
  return buildWorktreeBranchName(baseBranch, title, existingBranches);
}
