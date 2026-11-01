import { memo } from 'react';
import { ViewerChips } from '@renderer/features/work-list/file-row';
import type { WorkItemViewer } from '@renderer/features/work-list/use-viewing-presence';
import { statusTextClass } from '@renderer/lib/status-dot';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import { FileGlyph, FolderGlyph } from '../file-icon';
import { gitChangeSignal } from '../status-dot';
import type { ExplorerNode } from './tree';

/** Git's own one-letter status vocabulary, as the tree's trailing slot. */
const GIT_LETTER: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  conflicted: 'U',
};

export interface ExplorerRowActions {
  /** Single click: opens a preview tab the next preview replaces. */
  onPreview: (path: string) => void;
  /** Double click: promotes the preview to a pinned tab. */
  onPin: (path: string) => void;
  onOpenToSide: (path: string) => void;
  onAddToChat: (path: string) => void;
  onCopyPath: (path: string, relative: boolean) => void;
  onReveal: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}

/**
 * One tree row. A directory row toggles; a file row previews on a single click
 * and pins on a double, which is the preview-tab contract the centre pane
 * already implements. The row never expands detail in place — the whole row is
 * the press target and it navigates.
 *
 * Three decorations, all from git: the name is tinted by
 * change kind, the status letter sits in the trailing slot, and an ignored
 * path is dimmed and italic — present, reachable, and visibly not part of the
 * work.
 */
export const ExplorerRow = memo(function ExplorerRow({
  node,
  gitStatus,
  ignored = false,
  viewers,
  selected,
  actions,
}: {
  node: ExplorerNode;
  gitStatus: string | undefined;
  /** Excluded by .gitignore — shown, but visibly outside the work. */
  ignored?: boolean;
  viewers: WorkItemViewer[] | undefined;
  selected: boolean;
  actions: ExplorerRowActions;
}) {
  const isDirectory = node.type === 'dir';

  const row = (
    <button
      type="button"
      title={node.path}
      onClick={() =>
        isDirectory ? actions.onToggleDirectory(node.path) : actions.onPreview(node.path)
      }
      onDoubleClick={() => {
        if (!isDirectory) actions.onPin(node.path);
      }}
      style={{ paddingLeft: 8 + node.depth * 12 }}
      data-active={selected}
      className="list-card group mx-1 flex cursor-pointer items-center gap-1.5 rounded-lg py-1 pr-2 text-left transition-[background-color,border-color,box-shadow] duration-200"
    >
      {isDirectory ? (
        <FolderGlyph expanded={node.expanded} />
      ) : (
        <FileGlyph fileName={node.name} gitStatus={gitStatus} />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-list-row',
          gitStatus ? statusTextClass(gitChangeSignal(gitStatus)) : 'text-text',
          ignored && 'italic text-text-passive'
        )}
      >
        {node.name}
      </span>
      {viewers && viewers.length > 0 && <ViewerChips viewers={viewers} />}
      {gitStatus && (
        <span
          aria-label={gitStatus}
          title={gitStatus}
          className={cn(
            'w-3 shrink-0 text-center text-list-meta font-semibold',
            statusTextClass(gitChangeSignal(gitStatus))
          )}
        >
          {GIT_LETTER[gitStatus] ?? '•'}
        </span>
      )}
    </button>
  );

  if (isDirectory) return row;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div />}>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => actions.onPin(node.path)}>Open</ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onOpenToSide(node.path)}>
          Open to side
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onAddToChat(node.path)}>
          Add to chat
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => actions.onCopyPath(node.path, false)}>
          Copy path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onCopyPath(node.path, true)}>
          Copy relative path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onReveal(node.path)}>
          Reveal in file manager
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
