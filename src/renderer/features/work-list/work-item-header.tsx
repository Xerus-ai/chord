import {
  GitBranch,
  GitPullRequest,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Share2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRailStore } from '@renderer/features/right-rail/rail-store';
import { AvatarStack, type AvatarStackViewer } from '@renderer/lib/components/chrome/avatar-stack';
import { CapabilityTooltip } from '@renderer/lib/components/chrome/chrome-action-button';
import {
  HEADER_ICON_BUTTON,
  HEADER_OUTLINE_BUTTON,
  TopbarActions,
  TopbarBreadcrumb,
  TopbarShell,
  TopbarSpacer,
} from '@renderer/lib/components/chrome/topbar-shell';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import type { HeaderModel } from './work-item-header-model';

export const HEADER_CHIP =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xs border border-border bg-surface-inset px-2 py-0.5 text-tiny tracking-tiny font-semibold text-text-muted';

function InlineTitle({
  title,
  editing,
  onEditingChange,
  onRename,
}: {
  title: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    onEditingChange(false);
    if (trimmed && trimmed !== title) {
      onRename(trimmed);
    } else {
      setDraft(title);
    }
  }, [draft, title, onRename, onEditingChange]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(title);
            onEditingChange(false);
          }
        }}
        className="h-[26px] max-w-[260px] rounded-md border border-border bg-surface-raised px-1.5 text-body tracking-body font-medium text-text outline-none focus:border-border-strong"
      />
    );
  }

  return (
    <span
      className="min-w-0 max-w-[320px] cursor-text truncate text-body tracking-body font-medium text-text"
      onDoubleClick={() => onEditingChange(true)}
      title="Double-click to rename"
    >
      {title}
    </span>
  );
}

/**
 * The work item header, one for every viewer (step 4, S6), a workspace
 * header: title, repo, a kebab, the people, Share, and the rail toggle. What
 * shows comes from `headerModel`; the containers (`ChatTopbar` for the owner,
 * `CloudWorkItemHeader` for a teammate) supply the data and the slots only
 * the owner's machine can fill.
 *
 * The toggle lives here whether the rail is open or closed, so it never
 * moves; while the rail is closed the band's state falls back into this row
 * (`railClosedChip`), the one moment it has nowhere else to be.
 */
export function WorkItemHeader({
  model,
  viewers,
  onRename,
  onShare,
  railClosedChip,
  lanePrChips,
  openIn,
}: {
  model: HeaderModel;
  viewers: AvatarStackViewer[];
  /** Given exactly when the model allows a rename. */
  onRename?: (name: string) => void;
  onShare: () => void;
  railClosedChip?: ReactNode;
  /** Every lane's pull request, read from this machine's checkout (the owner's header). */
  lanePrChips?: ReactNode;
  /** Open in editor; the model shows it only with the checkout. */
  openIn?: ReactNode;
}) {
  const { toggleLeft, isLeftOpen } = useWorkspaceLayoutContext();
  const railOpen = useRailStore((state) => state.open);
  const toggleRail = useRailStore((state) => state.toggleOpen);
  const [editing, setEditing] = useState(false);
  const { share, stack } = model;
  const rename = model.canRename ? onRename : undefined;
  if (model.canRename && !onRename) throw new Error('A header that can rename needs onRename');

  return (
    <TopbarShell testId="work-item-header" className={cn(!railOpen && 'pr-window-controls')}>
      <button
        type="button"
        onClick={toggleLeft}
        aria-label={isLeftOpen ? 'Hide sidebar' : 'Show sidebar'}
        title={isLeftOpen ? 'Hide sidebar' : 'Show sidebar'}
        className={cn(HEADER_ICON_BUTTON, '-ml-1')}
      >
        <PanelLeft className="size-icon-md" strokeWidth={1.75} />
      </button>

      <TopbarBreadcrumb
        repoBadge={model.repoBadge}
        title={
          <>
            {rename ? (
              <InlineTitle
                title={model.title}
                editing={editing}
                onEditingChange={setEditing}
                onRename={rename}
              />
            ) : (
              <span className="min-w-0 max-w-[320px] truncate text-body tracking-body font-medium text-text">
                {model.title}
              </span>
            )}
            {model.status && (
              <span className="rounded-xs border border-border bg-surface-inset px-1.5 py-0 text-micro tracking-micro font-semibold uppercase text-text-muted">
                {model.status}
              </span>
            )}
          </>
        }
      />

      {(rename || share.kind !== 'hidden') && (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Work item actions" className={HEADER_ICON_BUTTON}>
            <MoreHorizontal className="size-icon-md" strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-44">
            {rename && (
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="size-icon-sm" />
                Rename
              </DropdownMenuItem>
            )}
            {share.kind !== 'hidden' && (
              <DropdownMenuItem
                onClick={onShare}
                disabled={share.kind === 'blocked'}
                title={share.kind === 'blocked' ? share.reason : undefined}
              >
                <Share2 className="size-icon-sm" />
                Share
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Gives way before the title does: what you are in is named first. */}
      {model.sharedBy && (
        <span className="min-w-0 shrink-[2] truncate text-tiny tracking-tiny text-text-passive">
          Shared by <span className="text-text-muted">{model.sharedBy}</span>
        </span>
      )}

      <TopbarSpacer />

      <TopbarActions>
        {!railOpen && railClosedChip}
        {/* Capped: at full width a long branch took the row and cut the
            item's name to three letters (devstation-9z7). */}
        {model.branch && (
          <span className={cn(HEADER_CHIP, 'max-w-[140px]')} title={model.branch}>
            <GitBranch className="h-[11px] w-[11px] shrink-0" />
            <span className="min-w-0 truncate">{model.branch}</span>
          </span>
        )}
        {model.prNumber !== null && (
          <span className={cn(HEADER_CHIP, 'tabular-nums')}>
            <GitPullRequest className="h-[11px] w-[11px]" />
            PR #{model.prNumber}
          </span>
        )}
        {lanePrChips}
        {stack.members.length > 0 && (
          <AvatarStack
            members={stack.members}
            viewers={viewers}
            ringedIds={stack.ringedIds}
            onClick={share.kind === 'open' ? onShare : undefined}
          />
        )}
        {model.openInEditor && openIn}
        {share.kind === 'open' && (
          <button type="button" onClick={onShare} className={HEADER_OUTLINE_BUTTON}>
            <Share2 className="size-icon-sm text-text-muted" strokeWidth={1.75} />
            Share
          </button>
        )}
        {share.kind === 'blocked' && (
          <CapabilityTooltip reason={share.reason}>
            <button
              type="button"
              aria-disabled
              className={cn(HEADER_OUTLINE_BUTTON, 'cursor-default opacity-60')}
            >
              <Share2 className="size-icon-sm text-text-muted" strokeWidth={1.75} />
              Share
            </button>
          </CapabilityTooltip>
        )}
        <button
          type="button"
          onClick={toggleRail}
          aria-label={railOpen ? 'Hide right panel' : 'Show right panel'}
          title={`${railOpen ? 'Hide' : 'Show'} right panel · Mod+L`}
          className={HEADER_ICON_BUTTON}
        >
          <PanelRight className="size-icon-md" strokeWidth={1.75} />
        </button>
      </TopbarActions>
    </TopbarShell>
  );
}
