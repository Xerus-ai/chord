import type { RepoWorktreeSources } from '@shared/worktree-sources';
import type { SidebarGroup } from './sidebar-projection';

/** The one line per repository counting the checkouts its worktree sources hide. */
export function describeWorktreeReviewLine(count: number): string | null {
  if (count === 0) return null;
  return `Review ${count} ${count === 1 ? 'worktree' : 'worktrees'}`;
}

/** Whether a repository has anything for the rail to show under it. */
function hasDiscovered(sources: RepoWorktreeSources): boolean {
  return sources.listed.length > 0 || sources.review.length > 0;
}

/**
 * The repo view's groups plus one empty group for each local repository
 * whose only rows are discovered checkouts: a Claude Code worktree appears
 * under its repository before the repository has a work item (plan §Phase 3
 * slice 6). A repository the user filtered out stays out.
 */
export function appendDiscoveredRepoGroups(args: {
  groups: readonly SidebarGroup[];
  sources: readonly RepoWorktreeSources[];
  repos: readonly { id: string; alias: string }[];
  visibleRepoIds: readonly string[];
}): SidebarGroup[] {
  const present = new Set(args.groups.map((group) => group.key));
  const aliasById = new Map(args.repos.map((repo) => [repo.id, repo.alias]));
  const added: SidebarGroup[] = [];
  for (const sources of args.sources) {
    if (present.has(sources.repoId) || !hasDiscovered(sources)) continue;
    if (args.visibleRepoIds.length > 0 && !args.visibleRepoIds.includes(sources.repoId)) continue;
    const alias = aliasById.get(sources.repoId);
    if (alias === undefined) continue;
    added.push({ kind: 'repo', key: sources.repoId, label: alias, tooltip: null, items: [] });
  }
  return [...args.groups, ...added];
}
