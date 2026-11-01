/**
 * Sanitising a human string into something usable as a git ref component (and,
 * since `WorktreeService` places a worktree at `<pool>/<branchName>`, as a
 * directory name too). Shared because both the primary work-item branch name
 * (`work-item-worktree-git.ts`, main) and the secondary-worktree branch name
 * (`worktrees.ts`, shared) need the identical sanitising rule — duplicating it
 * would let the two branch-naming schemes drift apart silently.
 */

/** Long enough to stay readable in `git branch`, short enough for Windows MAX_PATH. */
const MAX_SLUG_LENGTH = 48;

/**
 * `[a-z0-9-]` is comfortably inside both what git refs and Windows paths
 * accept, and collapsing everything else into `-` means the rules for refs
 * (no space, `~^:?*[`, `..`, trailing `.lock`) can never be hit.
 */
export function sanitizeRefSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toBranchSlug(name: string): string {
  const slug = sanitizeRefSegment(name).slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
  return slug || 'work-item';
}
