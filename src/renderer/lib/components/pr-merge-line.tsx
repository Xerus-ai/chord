import { GitBranch } from 'lucide-react';
import { parseGitHubRepository } from '@shared/github-repository';
import type { PullRequest } from '@shared/pull-requests';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

/**
 * Renders the GitHub-style merge summary line, e.g.:
 * "octocat wants to merge into acme:main from octocat:feat/my-branch"
 */
export function PrMergeLine({ pr, className }: { pr: PullRequest; className?: string }) {
  const author = pr.author?.userName;
  const baseOwner = parseGitHubRepository(pr.repositoryUrl)?.owner;
  const baseBranch = pr.baseRefName;
  const headOwner = parseGitHubRepository(pr.headRepositoryUrl)?.owner ?? author;
  const headBranch = pr.headRefName;
  const actionText = getPrMergeLineActionText(pr.status);

  return (
    <p
      className={cn(
        'text-tiny tracking-tiny text-text-muted flex items-center gap-1 min-w-0',
        className
      )}
    >
      {author && <span className="font-medium shrink-0">{author}</span>}
      {author && ' '}
      <span className="shrink-0">{actionText} </span>
      <PrBranchBadge owner={baseOwner} branch={baseBranch} />
      <span className="shrink-0"> from </span>
      <PrBranchBadge owner={headOwner} branch={headBranch} />
    </p>
  );
}

export function getPrMergeLineActionText(status: PullRequest['status']) {
  switch (status) {
    case 'merged':
      return 'merged into';
    case 'closed':
      return 'was closed without merging into';
    case 'open':
      return 'wants to merge into';
  }
}

function PrBranchBadge({ owner, branch }: { owner?: string; branch: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="min-w-0 overflow-hidden">
        <span className="font-mono text-micro tracking-micro font-medium flex items-center gap-1 min-w-0 bg-surface-inset px-1 py-0.5 rounded-md">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">
            {owner}:{branch}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {owner}:{branch}
      </TooltipContent>
    </Tooltip>
  );
}
