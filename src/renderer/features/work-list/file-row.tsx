import { File, MessageSquare, Undo2 } from 'lucide-react';
import { memo } from 'react';
import {
  participantColor,
  participantInitials,
} from '@renderer/lib/components/chrome/avatar-identity';
import type { ChangedFile } from './right-panel-types';
import type { WorkItemViewer } from './use-viewing-presence';

/**
 * File-list leaves shared by the file finder and the right rail's change rows.
 * Rows are memoized: the participant list re-renders on every RelativeTime
 * tick and presence event, and a row only changes when its file stats,
 * selection, or viewers do.
 */

export function ViewerChips({ viewers }: { viewers: WorkItemViewer[] }) {
  return (
    <span className="flex shrink-0 items-center">
      {viewers.slice(0, 2).map((v, i) => {
        const colors = participantColor(v.user_id);
        return (
          <span
            key={v.user_id}
            title={`${v.name ?? v.email} is viewing this file`}
            className={`flex h-[16px] w-[16px] items-center justify-center rounded-full text-avatar-sm font-semibold ${i > 0 ? '-ml-[4px] border border-surface-raised' : ''}`}
            style={{ background: colors.bg, color: colors.fg }}
          >
            {participantInitials(v.name, v.email)}
          </span>
        );
      })}
      {viewers.length > 2 && (
        <span
          title={viewers
            .slice(2)
            .map((v) => `${v.name ?? v.email} is viewing this file`)
            .join('\n')}
          className="-ml-[4px] flex h-[16px] w-[16px] items-center justify-center rounded-full border border-surface-raised bg-surface-hover-solid text-avatar-sm font-semibold text-text-muted"
        >
          +{viewers.length - 2}
        </span>
      )}
    </span>
  );
}

export const FileRow = memo(function FileRow({
  file,
  isSelected,
  onSelect,
  onRevert,
  viewers,
  showPendingDot = true,
}: {
  file: ChangedFile;
  isSelected: boolean;
  onSelect?: (file: ChangedFile) => void;
  /**
   * One-click revert — only offered when the file has no staged changes
   * (revert would be partial). The handler owns its own failure reporting;
   * the row fires it and does not wait.
   */
  onRevert?: (file: ChangedFile) => void | Promise<void>;
  viewers?: WorkItemViewer[];
  /** The owner's review-pending marker — meaningless in the read-only participant list. */
  showPendingDot?: boolean;
}) {
  return (
    <div
      onClick={() => onSelect?.(file)}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-body tracking-body transition-[background] duration-[80ms] ease-out hover:bg-surface-hover ${
        isSelected ? 'bg-surface-hover' : ''
      }`}
      style={{ minHeight: 36, contentVisibility: 'auto' }}
    >
      <File className="h-[14px] w-[14px] shrink-0 text-text-passive" />
      <span
        className="min-w-0 flex-1 truncate font-mono text-tiny tracking-tiny font-normal text-text-muted"
        style={{ direction: 'rtl', textAlign: 'left', fontVariantLigatures: 'none' }}
      >
        {file.name}
      </span>
      {onRevert && !file.staged && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void onRevert(file);
          }}
          title="Revert file changes"
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-xs border-none bg-transparent p-0.5 text-text-passive opacity-0 transition-[opacity,color] duration-100 ease-out hover:text-text-muted group-hover:opacity-100"
        >
          <Undo2 className="h-[12px] w-[12px]" />
        </button>
      )}
      {viewers && viewers.length > 0 && <ViewerChips viewers={viewers} />}
      {file.comments != null && file.comments > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-tiny tracking-tiny tabular-nums text-text-passive">
          <MessageSquare className="h-[10px] w-[10px]" />
          {file.comments}
        </span>
      )}
      <span
        className="flex shrink-0 items-center gap-1 font-mono text-tiny tracking-tiny font-medium tabular-nums"
        style={{ fontVariantLigatures: 'none' }}
      >
        <span className="text-diff-add">+{file.added}</span>
        {file.removed > 0 && <span className="text-diff-del">-{file.removed}</span>}
      </span>
      {showPendingDot && (
        <span
          className="shrink-0 bg-status-warn"
          style={{ width: 8, height: 8, borderRadius: 2 }}
          title="Pending review"
        />
      )}
    </div>
  );
});
