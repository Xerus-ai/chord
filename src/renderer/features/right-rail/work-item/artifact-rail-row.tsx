import { MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ArtifactRailCounts } from '@renderer/features/artifacts/artifact-rail-summary';
import type { FileBarCard } from '@renderer/features/work-list/file-bar';
import { ListRow } from '@renderer/lib/components/list-row';
import { FileIcon } from '@renderer/lib/editor/file-icon';

/**
 * An ARTIFACTS row (shared-items step 1, S8): the name opens the artifact's
 * tab; `💬 N•` and `vN` open it with that card. The counts are buttons of
 * their own, so they sit over the row's end rather than inside its button,
 * and the row keeps their width free.
 */
export function ArtifactRailRow({
  artifactId,
  name,
  filePath,
  counts,
  onOpen,
  onOpenCard,
}: {
  artifactId: string;
  name: string;
  /** The artifact's file, whose type picks the icon (as tabs do); empty for an artifact without one. */
  filePath: string;
  /** Undefined until the rail summary has this artifact. */
  counts: ArtifactRailCounts | undefined;
  onOpen: () => void;
  onOpenCard: (card: FileBarCard) => void;
}) {
  const comments = counts?.comments ?? null;
  const latestVersion = counts?.latestVersion ?? null;
  return (
    <div className="relative">
      <ListRow
        leading={<FileIcon filename={filePath || name} size={14} className="size-icon-sm" />}
        title={name}
        onOpen={onOpen}
        trailing={<span aria-hidden className="w-20 shrink-0" />}
      />
      <span
        data-testid="artifact-rail-counts"
        data-artifact-id={artifactId}
        data-unread={String(comments?.unread === true)}
        className="absolute inset-y-0 right-3 flex items-center gap-0.5"
      >
        {comments && (comments.open > 0 || comments.unread) && (
          <CountButton title="Open comments" onClick={() => onOpenCard('comments')}>
            <MessageSquare className="size-icon-sm" />
            {comments.open}
            {comments.unread && (
              <span aria-label="unread" className="size-1.5 rounded-full bg-status-running" />
            )}
          </CountButton>
        )}
        {latestVersion !== null && (
          <CountButton title="Open versions" onClick={() => onOpenCard('versions')}>
            v{latestVersion}
          </CountButton>
        )}
      </span>
    </div>
  );
}

function CountButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-[18px] cursor-pointer items-center gap-1 rounded px-1 text-list-meta tabular-nums text-text-passive transition-colors hover:bg-surface-hover-solid hover:text-text"
    >
      {children}
    </button>
  );
}
