import {
  Archive,
  Loader2,
  MoreHorizontal,
  Plus,
  Settings,
  Shapes,
  Undo2,
  Wand2,
} from 'lucide-react';
import type { RepoIcon, RepoIconChoice } from '@shared/repo-icons';
import { ARCHIVE_REPOSITORY_TITLE } from '@renderer/features/settings/use-archive-repository';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import { REPO_ICON_CHOICES } from './repo-icon-map';

export interface RepoGroupActions {
  onNewWorkItem: (repoId: string) => void;
  /** Opens this repository's own settings page. */
  onOpenRepositorySettings: (repoId: string) => void;
  /** A hand-picked glyph, or `{ type: 'letter' }` to settle on the letter tile.
   *  An image is never submitted from here — there is no upload path. */
  onChooseIcon: (repoId: string, icon: RepoIconChoice) => void;
  /** Re-runs auto-detection and reports what it found. */
  onDetectIcon: (repoId: string) => void;
  /** The repo whose detection is in flight, if any. Carried on the actions
   *  object rather than as a prop so the header chain stays unchanged. */
  detectingRepoId: string | null;
  onArchive: (repoId: string) => void;
}

/**
 * The repo header's `···` menu.
 *
 * Open state is controlled from the header so right-clicking the row can open
 * the same menu — one definition behind both affordances, which is what keeps
 * them from drifting apart — and so the header can keep its actions visible
 * while the menu is up.
 *
 * There is no Remove: a repo header only exists in the sidebar while the repo
 * has work items, and hard deletion is refused for any repo a work item still
 * references (repos controller `remove`). An entry here could never succeed,
 * so removal stays in Settings, where an empty repo can be reached.
 */
export function RepoGroupMenu({
  repoId,
  label,
  currentIcon,
  actions,
  open,
  onOpenChange,
}: {
  repoId: string;
  label: string;
  currentIcon: RepoIcon | null;
  actions: RepoGroupActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const currentKey = currentIcon?.type === 'lucide' ? currentIcon.key : null;
  const detecting = actions.detectingRepoId === repoId;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label={`${label} options`}
        title={`${label} options`}
        // The header row toggles collapse on click; the kebab is inside it.
        onClick={(event) => event.stopPropagation()}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-inset hover:text-text"
      >
        <MoreHorizontal className="size-icon-sm" strokeWidth={2.25} />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-52" align="start">
        <DropdownMenuItem onClick={() => actions.onOpenRepositorySettings(repoId)}>
          <Settings />
          Repository settings
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Shapes />
            Change icon
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto">
            <div className="grid grid-cols-6 gap-0.5">
              {/* A detected image leads the grid, selected: it is what the repo
                  is wearing, and a picker that cannot show the current value
                  makes the user guess what they are replacing. It is not
                  clickable — re-selecting it is what Detect does. */}
              {currentIcon?.type === 'image' && (
                <div
                  title={`${label} (detected)`}
                  className="flex size-7 items-center justify-center rounded-sm bg-surface-active p-0"
                >
                  <img
                    src={currentIcon.src}
                    alt=""
                    draggable={false}
                    className="size-icon-md rounded-xs object-cover"
                  />
                </div>
              )}
              {REPO_ICON_CHOICES.map(({ key, Icon }) => (
                <DropdownMenuItem
                  key={key}
                  aria-label={key}
                  title={key}
                  className={cn(
                    'size-7 justify-center p-0',
                    key === currentKey && 'bg-surface-active text-text'
                  )}
                  onClick={() => actions.onChooseIcon(repoId, { type: 'lucide', key })}
                >
                  <Icon />
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={detecting}
              title="Look for an icon in the repository, then fall back to the GitHub owner's avatar"
              onClick={() => actions.onDetectIcon(repoId)}
            >
              {detecting ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {detecting ? 'Detecting…' : 'Detect from repository'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onChooseIcon(repoId, { type: 'letter' })}>
              <Undo2 />
              Reset to letter
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem onClick={() => actions.onNewWorkItem(repoId)}>
          <Plus />
          New work item
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          title={ARCHIVE_REPOSITORY_TITLE}
          onClick={() => actions.onArchive(repoId)}
        >
          <Archive />
          Archive repository
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
