import { FolderGit2 } from 'lucide-react';
import {
  useFocusedWorktreeId,
  useLiveWorktrees,
} from '@renderer/features/right-rail/use-focused-worktree';
import { cn } from '@renderer/utils/utils';
import { companionChipLabel, focusedLaneCompanion } from './header-companion-model';
import { HEADER_CHIP } from './work-item-header';

/**
 * The work item header names the companion checkout the focused lane is
 * nested in (devstation-4x42.243), where its sessions start; the full path is
 * its title. Nothing for a lane without one.
 */
export function HeaderCompanionChip({ workItemId }: { workItemId: string }) {
  const worktrees = useLiveWorktrees(workItemId);
  const focusedWorktreeId = useFocusedWorktreeId(workItemId, workItemId);
  const companionPath = focusedLaneCompanion(worktrees, focusedWorktreeId);
  if (companionPath === null) return null;
  return (
    <span
      className={cn(HEADER_CHIP, 'max-w-[160px]')}
      title={`Companion checkout: ${companionPath}`}
      data-testid="header-companion-chip"
    >
      <FolderGit2 className="h-[11px] w-[11px] shrink-0" />
      <span className="min-w-0 truncate">{companionChipLabel(companionPath)}</span>
    </span>
  );
}
