import { ChevronDown, GitBranch } from 'lucide-react';
import type { Worktree } from '@shared/worktrees';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

/**
 * A single worktree is the common case, and its branch already shows in the
 * `BranchPill` beside it — a second pill naming the same thing would be
 * noise. This only earns its place once a work item has grown a second
 * worktree and "which one is this draft going into" stops being obvious.
 */
export function shouldShowWorktreePill(worktrees: readonly Worktree[] | undefined): boolean {
  return (worktrees?.length ?? 0) > 1;
}

/** Falls back to the title, then the id, for a worktree whose branch hasn't
 *  been created yet. */
export function worktreePillLabel(worktree: Worktree | undefined): string {
  if (!worktree) return 'Worktree';
  return worktree.branchName ?? worktree.title ?? worktree.id;
}

/**
 * The composer's worktree picker: which of the work item's parallel
 * worktrees this draft is sent into. Read-only (no `onWorktreeChange`) for a
 * session tab already bound to one worktree — switching there mid-turn would
 * move the ground out from under a running agent, the same reasoning that
 * keeps `BranchPill` static.
 */
export function WorktreePill({
  worktrees,
  worktreeId,
  onWorktreeChange,
}: {
  worktrees: readonly Worktree[];
  worktreeId?: string | null;
  onWorktreeChange?: (worktreeId: string) => void;
}) {
  const current = worktrees.find((w) => w.id === worktreeId) ?? worktrees[0];
  const label = worktreePillLabel(current);

  if (!onWorktreeChange) {
    return (
      <span
        title={`Working in ${label}`}
        className="inline-flex min-w-0 max-w-[160px] items-center gap-1 whitespace-nowrap rounded-full border border-border bg-transparent px-2 py-1 text-tiny tracking-tiny font-normal text-text-passive"
        style={{ minHeight: 24 }}
      >
        <GitBranch className="size-icon-xs shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Worktree — ${label}`}
        title={`Working in ${label}`}
        className="inline-flex min-w-0 max-w-[160px] cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border border-border bg-transparent px-2 py-1 text-tiny tracking-tiny font-normal text-text-passive transition-[color,border-color,background] duration-[80ms] hover:border-border-strong hover:bg-surface-inset hover:text-text-muted active:translate-y-px"
        style={{ minHeight: 24 }}
      >
        <GitBranch className="size-icon-xs shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown className="ml-[1px] size-icon-xs shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {worktrees.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => onWorktreeChange(w.id)}
            className={w.id === current?.id ? 'bg-selected-bg text-text' : undefined}
          >
            <GitBranch className="size-icon-sm" />
            {worktreePillLabel(w)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
