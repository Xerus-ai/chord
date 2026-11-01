import { MoreHorizontal, Save, Trash2 } from 'lucide-react';
import type { ArtifactType } from '@shared/stream-items';
import { ConfluenceBarChip } from '@renderer/features/confluence/confluence-bar-chip';
import type { WorkItemViewer } from '@renderer/features/work-list/use-viewing-presence';
import { PresenceAvatars } from './presence-avatars';
import { useDropdown } from './use-dropdown';

/**
 * The artifact controls that sit in the path tab's file bar (design
 * 2026-09-26 §8): who is viewing, and the More menu (Save version, Delete).
 * Sharing is the header's one Share button (step 3), with this artifact
 * preselected. The page modes left in S6: picking is the comments card's
 * click-to-comment, and text editing is a double-click.
 */

function IconButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-md border-none bg-transparent transition-colors hover:bg-surface-hover-solid ${
        active ? 'text-text' : 'text-text-passive hover:text-text-muted'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Sharing an artifact goes through the Share action, which copies a link the
 * server actually issued. The menu no longer offers a second "Copy link" that
 * fabricated a `chord://artifact/<id>` URL — the protocol handler only routes
 * `/auth/callback`, so that string resolved to nothing wherever it was pasted.
 */
export function MoreMenu({
  onSaveVersion,
  onDelete,
}: {
  onSaveVersion?: () => void;
  onDelete?: () => void;
}) {
  const { open, setOpen, ref } = useDropdown();

  return (
    <div ref={ref} className="relative">
      <IconButton title="More actions" onClick={() => setOpen((v) => !v)} active={open}>
        <MoreHorizontal className="h-[13px] w-[13px]" />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-52 rounded-lg border border-border-strong bg-surface-inset p-1 shadow-lg">
          {onSaveVersion && (
            <MenuItem
              onClick={() => {
                onSaveVersion();
                setOpen(false);
              }}
              icon={<Save className="h-3.5 w-3.5" />}
            >
              Save version
            </MenuItem>
          )}
          {onDelete && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Delete artifact
            </MenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-body tracking-body text-text-muted transition-colors hover:bg-surface-hover-solid hover:text-text"
    >
      <span className="flex-shrink-0 text-text-passive">{icon}</span>
      {children}
    </button>
  );
}

/** Everything an artifact adds to the right of its file bar, until each piece moves to its home. */
export function ArtifactBarTrailing({
  viewers,
  confluence,
  onSaveVersion,
  onDelete,
}: {
  viewers: WorkItemViewer[];
  /** The owner's published artifact: its Confluence chip, which opens Publish. */
  confluence?: {
    artifactId: string;
    artifactType: ArtifactType | null;
    content: string | null;
    onPublished: () => void;
    onOpenPublish: () => void;
  };
  onSaveVersion?: () => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <PresenceAvatars viewers={viewers} />
      {confluence && <ConfluenceBarChip {...confluence} />}
      {(onSaveVersion || onDelete) && (
        <MoreMenu onSaveVersion={onSaveVersion} onDelete={onDelete} />
      )}
    </>
  );
}
