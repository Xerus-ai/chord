import { ArrowUp, ChevronDown, GitBranch, RefreshCw } from 'lucide-react';
import type { Worktree } from '@shared/worktrees';
import { MiddleTruncate } from '@renderer/lib/components/middle-truncate';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

export type ComparisonMode = 'uncommitted' | 'base';

const READING_COMPARE_BASE = 'Reading the compare base…';

/**
 * Two scope rows: which checkout the tree below belongs to, and what
 * it is being compared against.
 *
 * They replace the segmented Uncommitted / vs base control. A segment pair is
 * a setting; these read as a sentence — this branch, against that base, N
 * commits ahead; showing uncommitted work, +A −D of it — which is the question
 * a changed-file list actually answers.
 *
 * The branch itself is not switchable here. A worktree's branch is the work
 * item's, and moving it would silently re-point the work item; what the first
 * row switches is which worktree you are looking at.
 */
export function ScopeRows({
  worktrees,
  focusedWorktreeId,
  branchName,
  baseBranch,
  compareLabel,
  aheadCount,
  comparison,
  onComparisonChange,
  onFocusWorktree,
  totals,
  refreshing,
  onRefresh,
}: {
  worktrees: Worktree[];
  focusedWorktreeId: string | null;
  branchName: string | null;
  baseBranch: string | null;
  /** `vs <ref>` for the compare base Settings › Git names; null while it is read. */
  compareLabel: string | null;
  aheadCount: number | null;
  comparison: ComparisonMode;
  onComparisonChange: (mode: ComparisonMode) => void;
  onFocusWorktree: (worktreeId: string) => void;
  totals: { added: number; removed: number };
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col border-b border-border-subtle">
      <div className="flex h-[34px] items-center gap-1.5 pl-2 pr-2.5">
        <ScopeMenu
          label={branchName ?? 'Detached HEAD'}
          icon={<GitBranch className="size-icon-xs shrink-0" />}
          mono
          middleTruncate
          disabled={worktrees.length < 2}
          title={
            worktrees.length < 2
              ? 'This work item has one worktree'
              : 'Show another worktree’s changes'
          }
        >
          {worktrees.map((worktree) => (
            <DropdownMenuItem
              key={worktree.id}
              disabled={worktree.id === focusedWorktreeId}
              onClick={() => onFocusWorktree(worktree.id)}
            >
              {worktree.branchName ?? worktree.title ?? 'Worktree'}
            </DropdownMenuItem>
          ))}
        </ScopeMenu>

        {baseBranch && (
          // The base gives way, not the branch: a secondary lane's base is the
          // primary's branch, as long as its own, and it used to squeeze the
          // trigger to nothing. It loses its middle too, keeping its own end.
          <span className="flex min-w-0 items-baseline gap-1 text-list-meta text-text-passive">
            <span className="shrink-0">→</span>
            <MiddleTruncate text={baseBranch} />
          </span>
        )}
        {aheadCount !== null && aheadCount > 0 && (
          <span
            title={`${aheadCount} commit${aheadCount === 1 ? '' : 's'} not on the remote`}
            className="flex shrink-0 items-center gap-0.5 text-list-meta tabular-nums text-text-passive"
          >
            <ArrowUp className="size-icon-xs" />
            {aheadCount}
          </span>
        )}
        <span className="flex-1" />
        {worktrees.length > 1 && (
          <span className="shrink-0 text-list-meta text-text-passive">
            {worktrees.length} worktrees
          </span>
        )}
      </div>

      <div className="flex h-[34px] items-center gap-1.5 pl-2 pr-2.5">
        {/* Until the compare base is read there is no base to name: say so,
            rather than a made-up "vs base" or an "Uncommitted" that isn't shown. */}
        <ScopeMenu
          label={comparison === 'base' ? (compareLabel ?? READING_COMPARE_BASE) : 'Uncommitted'}
        >
          <DropdownMenuItem onClick={() => onComparisonChange('uncommitted')}>
            Uncommitted
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!compareLabel} onClick={() => onComparisonChange('base')}>
            {compareLabel ?? READING_COMPARE_BASE}
          </DropdownMenuItem>
        </ScopeMenu>

        {(totals.added > 0 || totals.removed > 0) && (
          <span className="flex shrink-0 items-center gap-1 font-mono text-list-meta tabular-nums">
            <span className="text-diff-add">+{totals.added}</span>
            <span className="text-diff-del">-{totals.removed}</span>
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Refresh changes"
          title="Refresh changes"
          onClick={onRefresh}
          className="flex size-6 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-text-passive transition-colors hover:bg-surface-hover hover:text-text"
        >
          <RefreshCw className={cn('size-icon-xs', refreshing && 'animate-spin')} />
        </button>
      </div>
    </div>
  );
}

/** A scope value that opens a menu — the row's only interactive shape. */
function ScopeMenu({
  label,
  icon,
  mono,
  middleTruncate,
  disabled,
  title,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  mono?: boolean;
  /** A branch: it loses its middle, not the end that tells lanes apart. */
  middleTruncate?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const trigger = (
    <button
      type="button"
      title={title ?? label}
      disabled={disabled}
      className={cn(
        'flex h-6 min-w-0 max-w-[60%] cursor-pointer items-center gap-1 rounded-md border-none bg-transparent px-1.5 text-left text-list-row text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-default disabled:hover:bg-transparent',
        mono && 'font-mono',
        // A branch keeps its width, up to its 60%; what follows it shrinks.
        middleTruncate && 'shrink-0'
      )}
      style={mono ? { fontVariantLigatures: 'none' } : undefined}
    >
      {icon}
      {middleTruncate ? (
        <MiddleTruncate text={label} />
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
      {!disabled && <ChevronDown className="size-icon-xs shrink-0 text-text-passive" />}
    </button>
  );

  if (disabled) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="start" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
