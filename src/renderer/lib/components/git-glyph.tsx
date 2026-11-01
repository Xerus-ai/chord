import {
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from 'lucide-react';

/**
 * The git-fact glyph vocabulary, and the one icon mapping behind it.
 *
 * Every surface that shows "what state is this branch in" — the sidebar row,
 * its hover card, the rail's worktree groups — draws from this. Defining the
 * union here rather than in a feature keeps the mapping and the type in the
 * same place, so a new state cannot be added to one without the other.
 */
export type GitGlyph = 'pull_request' | 'conflict' | 'merged' | 'closed' | 'draft' | 'branch';

export const GLYPH_ICON: Record<GitGlyph, LucideIcon> = {
  pull_request: GitPullRequest,
  // A conflicting PR and a closed one wear the same crossed glyph; the tone
  // is what separates "you have work to do" from "this is over".
  conflict: GitPullRequestClosed,
  closed: GitPullRequestClosed,
  merged: GitMerge,
  draft: GitPullRequestDraft,
  branch: GitBranch,
};
