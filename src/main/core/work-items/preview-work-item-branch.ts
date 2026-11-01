import { ok, type Result } from '@shared/result';
import type { BranchPrefixError } from './branch-prefix';
import { resolveBranchPrefix } from './resolve-branch-prefix';
import { buildWorkItemBranchName } from './work-item-worktree-git';

/**
 * The branch `createWorkItem` will make for this name and id: the same prefix
 * resolution and the same builder, so the create dialog's `Branch:` line is
 * the branch created (the dialog sends the same id with the request).
 */
export async function previewWorkItemBranch(args: {
  name: string;
  workItemId: string;
}): Promise<Result<{ branchName: string }, BranchPrefixError>> {
  const prefix = await resolveBranchPrefix();
  if (!prefix.success) return prefix;
  return ok({
    branchName: buildWorkItemBranchName({
      name: args.name,
      workItemId: args.workItemId,
      branchPrefix: prefix.data,
    }),
  });
}
