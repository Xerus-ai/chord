import { Copy, History, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { toast } from '@renderer/lib/hooks/use-toast';
import { statusTextClass, type StatusSignal } from '@renderer/lib/status-dot';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import { cn } from '@renderer/utils/utils';
import type { PathMode } from './center-tab';
import { pathModeLabel } from './path-tab-modes';

export type FileBarCard = 'comments' | 'versions';

export interface FileBarModeSwitch {
  modes: readonly PathMode[];
  mode: PathMode;
  canEdit: boolean;
  onChange: (mode: PathMode) => void;
}

/**
 * A viewer with no checkout sees an artifact only as its Preview (design
 * 2026-09-26 §6). One mode: the switch is not shown, so nothing switches.
 */
export const PREVIEW_ONLY_MODE_SWITCH: FileBarModeSwitch = {
  modes: ['preview'],
  mode: 'preview',
  canEdit: false,
  onChange: (mode) => {
    throw new Error(`A preview-only tab has no ${mode} mode`);
  },
};

/** An artifact's status, as `artifactStatusBadge` names it. */
export interface FileBarStatus {
  label: string;
  signal: StatusSignal;
}

/** The artifact's two cards: its comments and its versions (design 2026-09-26 §3). */
export interface FileBarArtifact {
  openComments: number;
  unreadComments: boolean;
  /** `vN` of what is shown: the version being viewed, else the latest. Null before any version. */
  versionNumber: number | null;
  activeCard: FileBarCard | null;
  onToggleCard: (card: FileBarCard) => void;
}

/** An old version is on screen: the mode switch gives way to its own controls. */
export interface FileBarViewing {
  /** Null when the version row carries no number. */
  versionNumber: number | null;
  onRestore?: () => void;
  onBackToLatest: () => void;
}

/** Copies to the clipboard and says so; a refused write says that instead. */
export function copyToClipboard(text: string, what: string): void {
  void navigator.clipboard.writeText(text).then(
    () => toast({ title: `Copied ${what}` }),
    (error: unknown) =>
      toast({ title: `Could not copy ${what}`, description: String(error), variant: 'destructive' })
  );
}

function BarButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-1 rounded-md px-[7px] text-tiny tracking-tiny tabular-nums transition-colors',
        active
          ? 'bg-surface-hover-solid text-text'
          : 'text-text-muted hover:bg-surface-hover-solid hover:text-text'
      )}
    >
      {children}
    </button>
  );
}

/**
 * The path tab's one header row (design 2026-09-26 §3):
 * path chip · [trailing] · 💬 N · 🕘 vN · copy · Diff · Preview · Edit.
 * Clicking the chip copies the path; ⧉ copies the contents.
 */
export function FileBar({
  filePath,
  title,
  modeSwitch,
  artifact,
  viewing,
  onCopyContents,
  status = null,
  trailing,
}: {
  /** Repo-relative path; absent for an artifact with no repo file. */
  filePath?: string;
  title: string;
  modeSwitch: FileBarModeSwitch;
  artifact?: FileBarArtifact;
  viewing?: FileBarViewing;
  /** Null while the contents are not loaded. */
  onCopyContents: (() => void) | null;
  /** An artifact's status (Draft, In review, Approved, Built). */
  status?: FileBarStatus | null;
  /** Controls that live in the bar until their own home ships (sharing, publishing). */
  trailing?: ReactNode;
}) {
  const shown = filePath ?? title;
  const lastSlash = shown.lastIndexOf('/');
  const directory = lastSlash === -1 ? '' : shown.slice(0, lastSlash + 1);
  const name = shown.slice(lastSlash + 1);

  return (
    <div
      data-testid="file-bar"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-3"
    >
      <button
        type="button"
        title={filePath ? 'Copy path' : title}
        onClick={() => filePath && copyToClipboard(filePath, 'path')}
        className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 font-mono text-tiny tracking-tiny hover:border-border"
      >
        <FileIcon filename={name} size={14} className="size-icon-sm shrink-0" />
        {directory && <span className="truncate text-text-passive">{directory}</span>}
        <span className="shrink-0 font-medium text-text">{name}</span>
      </button>

      <span className="flex-1" />
      {status && (
        <span
          data-testid="artifact-status"
          className={cn(
            'shrink-0 px-1 text-tiny tracking-tiny font-medium',
            statusTextClass(status.signal)
          )}
        >
          {status.label}
        </span>
      )}
      {trailing}

      {artifact && (
        <>
          <BarButton
            title="Comments"
            active={artifact.activeCard === 'comments'}
            onClick={() => artifact.onToggleCard('comments')}
          >
            <MessageSquare className="size-icon-sm" />
            {artifact.openComments > 0 && artifact.openComments}
            {artifact.unreadComments && (
              <span aria-label="unread" className="size-1.5 rounded-full bg-status-running" />
            )}
          </BarButton>
          <BarButton
            title="Versions"
            active={artifact.activeCard === 'versions'}
            onClick={() => artifact.onToggleCard('versions')}
          >
            <History className="size-icon-sm" />
            {artifact.versionNumber !== null && `v${artifact.versionNumber}`}
          </BarButton>
        </>
      )}

      {onCopyContents && (
        <BarButton title="Copy contents" onClick={onCopyContents}>
          <Copy className="size-icon-sm" />
        </BarButton>
      )}

      {viewing ? (
        <span
          data-testid="viewing-version"
          className="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md bg-status-warn-bg pl-2.5 pr-1 text-tiny tracking-tiny text-status-warn"
        >
          {viewing.versionNumber !== null
            ? `Viewing v${viewing.versionNumber}`
            : 'Viewing an older version'}
          {viewing.onRestore && (
            <BarButton title="Save this version as the newest" onClick={viewing.onRestore}>
              Restore
            </BarButton>
          )}
          <BarButton title="Back to the latest version" onClick={viewing.onBackToLatest}>
            Back to latest
          </BarButton>
        </span>
      ) : (
        modeSwitch.modes.length > 1 && (
          <SegmentedControl
            size="xs"
            ariaLabel="View"
            value={modeSwitch.mode}
            onChange={modeSwitch.onChange}
            options={modeSwitch.modes.map((mode) => ({
              value: mode,
              label: pathModeLabel(mode, modeSwitch.canEdit),
            }))}
          />
        )
      )}
    </div>
  );
}
