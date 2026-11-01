import { Check, Copy, Eye, EyeOff, Pin, PinOff, Share2, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SharingAvailability } from '@renderer/features/sharing/sharing-availability';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import type { SidebarItem } from './sidebar-projection';

export interface RowContextMenuActions {
  onOpen: (workItemId: string) => void;
  onTogglePinned: (workItemId: string) => void;
  onSetReadState: (workItemId: string, read: boolean) => void;
  onCopyBranch: (branchName: string) => void;
  onMarkDone: (workItemId: string) => void;
  onShare: (item: SidebarItem) => void;
  /** Whether Share works for this row yet, and if not, why. */
  shareAvailability: (item: SidebarItem) => SharingAvailability;
  onDelete: (workItemId: string) => void;
}

/**
 * The row menu, reached by right-click or by the hover kebab — one menu, so
 * the two affordances can never drift apart. A teammate's item offers only
 * what a participant may actually do: it is not ours to rename, finish, or
 * delete, and the pin and read flags are per-user state that is.
 */
export function RowContextMenu({
  item,
  isPinned,
  actions,
  children,
}: {
  item: SidebarItem;
  isPinned: boolean;
  actions: RowContextMenuActions;
  children: ReactNode;
}) {
  const isMine = item.ownership === 'mine';

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => actions.onOpen(item.id)}>Open</ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onTogglePinned(item.id)}>
          {isPinned ? <PinOff /> : <Pin />}
          {isPinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onSetReadState(item.id, !item.unread)}>
          {item.unread ? <Eye /> : <EyeOff />}
          {item.unread ? 'Mark read' : 'Mark unread'}
        </ContextMenuItem>

        {item.branchName && (
          <ContextMenuItem onClick={() => actions.onCopyBranch(item.branchName as string)}>
            <Copy />
            Copy branch
          </ContextMenuItem>
        )}

        {isMine && (
          <>
            <ContextMenuSeparator />
            <ShareMenuItem item={item} actions={actions} />
            {item.bucket !== 'done' && (
              <ContextMenuItem onClick={() => actions.onMarkDone(item.id)}>
                <Check />
                Mark done
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => actions.onDelete(item.id)}>
              <Trash2 />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Share, or why it is not available yet (still syncing, another account's, signed out). */
function ShareMenuItem({ item, actions }: { item: SidebarItem; actions: RowContextMenuActions }) {
  const availability = actions.shareAvailability(item);
  const blockedBy = availability.kind === 'available' ? null : availability.reason;
  return (
    <ContextMenuItem
      onClick={() => actions.onShare(item)}
      disabled={blockedBy !== null}
      title={blockedBy ?? undefined}
    >
      <Share2 />
      {blockedBy === null ? 'Share' : `Share · ${blockedBy}`}
    </ContextMenuItem>
  );
}
