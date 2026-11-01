import { Ellipsis, FolderGit2, GitBranch } from 'lucide-react';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';

type ForkTarget = 'tab' | 'worktree';

type ForkState = { step: 'idle'; error: string | null } | { step: 'forking'; target: ForkTarget };

const ITEM_CLASS = 'text-tiny tracking-tiny';

/**
 * The turn footer's "…" menu (plan §"Decisions for Phase 5", Fork): start a
 * new chat of the same agent from this turn, in a new tab on the same lane or
 * on a new lane made from the turn's checkpoint. Shown only on turns that
 * have a point in their conversation to fork at; Fork to new worktree only
 * where the turn has a checkpoint too. The menu closes on a choice; the fork's
 * progress, then any failure, is shown beside it.
 *
 * The menu is a portal, not an absolute box: the transcript's rows are
 * translated, so a box inside this row would sit under the rows after it.
 */
export function TurnForkMenu({
  onForkToNewTab,
  onForkToNewWorktree,
}: {
  onForkToNewTab: () => Promise<void>;
  onForkToNewWorktree?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ForkState>({ step: 'idle', error: null });
  const forking = state.step === 'forking';
  const error = state.step === 'idle' ? state.error : null;

  const fork = async (target: ForkTarget, run: () => Promise<void>) => {
    setState({ step: 'forking', target });
    try {
      await run();
      setState({ step: 'idle', error: null });
    } catch (e) {
      setState({ step: 'idle', error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <span
      className={`relative flex items-center gap-2 transition-opacity duration-100 ease-out focus-within:opacity-100 group-hover/turn:opacity-100 ${
        open || forking || error ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          aria-label="More for this turn"
          disabled={forking}
          className="flex cursor-pointer items-center rounded-md border-none bg-transparent px-0 py-0.5 text-text-muted hover:text-text disabled:cursor-default"
        >
          <Ellipsis className="size-icon-xs" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48">
          <DropdownMenuItem className={ITEM_CLASS} onClick={() => void fork('tab', onForkToNewTab)}>
            <GitBranch className="size-icon-xs" />
            Fork to new tab
          </DropdownMenuItem>
          {onForkToNewWorktree && (
            <DropdownMenuItem
              className={ITEM_CLASS}
              onClick={() => void fork('worktree', onForkToNewWorktree)}
            >
              <FolderGit2 className="size-icon-xs" />
              Fork to new worktree
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {forking && (
        <span className="text-tiny tracking-tiny text-text-passive">
          {state.target === 'tab' ? 'Forking…' : 'Making the worktree…'}
        </span>
      )}
      {error && <span className="text-tiny tracking-tiny text-status-err">{error}</span>}
    </span>
  );
}
