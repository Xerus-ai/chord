import { CircleCheck, CircleX, ExternalLink, GitBranch, Waves } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { RepoIcon } from '@shared/repo-icons';
import { GLYPH_ICON } from '@renderer/lib/components/git-glyph';
import { rpc } from '@renderer/lib/ipc';
import {
  getStatusWord as getBucketWord,
  statusDotClass,
  statusSignalForBucket,
  statusTextClass,
} from '@renderer/lib/status-dot';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/lib/ui/hover-card';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { RepoIdentityTile } from './repo-identity-tile';
import {
  capitalizeStatusWord,
  getGitGlyph,
  getHoverCardAction,
  getStatusWord,
} from './row-presentation';
import type { SidebarItem } from './sidebar-projection';

const HOVER_DELAY_MS = 300;

const CHECKS_ICON = { passing: CircleCheck, failing: CircleX, pending: null } as const;
const CHECKS_LABEL = {
  passing: 'checks passing',
  failing: 'checks failing',
  pending: 'checks pending',
} as const;
const CHECKS_TONE = {
  passing: 'text-status-ok',
  failing: 'text-status-err',
  pending: 'text-text-muted',
} as const;

/**
 * The hover card's one action, from `getHoverCardAction`. `open_pull_request`
 * really opens the PR in the system browser via `rpc.app.openExternal` —
 * the same mechanism `pr-badge.tsx` uses — rather than routing through the
 * renderer, which has nowhere to put a GitHub page.
 */
function HoverCardAction({
  item,
  onOpen,
  onActed,
}: {
  item: SidebarItem;
  onOpen: (workItemId: string) => void;
  onActed: () => void;
}) {
  const action = getHoverCardAction(item);
  if (!action) return null;

  return (
    <button
      type="button"
      onClick={() => {
        onActed();
        if (action.kind === 'open_pull_request') {
          void rpc.app.openExternal(action.url);
        } else {
          onOpen(item.id);
        }
      }}
      className="mt-3 flex h-7 w-fit items-center gap-1.5 rounded-md bg-action-bg px-2.5 text-tiny tracking-tiny font-medium text-action-fg transition-colors hover:bg-action-bg/90"
    >
      {action.label}
    </button>
  );
}

/**
 * Everything the row deliberately does not say. The row carries a title, a
 * dot and three facts; the second-order detail — first prompt, PR, worktree
 * count, dev server — lives here, so the list keeps its density (§7) without
 * hiding the information.
 *
 * Built on `lib/ui/hover-card.tsx` (Base UI's PreviewCard) rather than
 * `Tooltip`: a tooltip's popup cannot take focus or clicks, so the card's one
 * action button and its PR link were dead. PreviewCard's trigger `delay` /
 * `closeDelay` give the open-after-hover and stay-open-while-travelling
 * behaviour for free; only the "close immediately" cases — a row click, a
 * context menu opening — are handled here. Closing alone was not enough: a
 * click inside the hover delay closed a card that was not open yet, and the
 * pending open fired after it, leaving the card over the item just opened
 * (devstation-2f3). So the card is controlled, and a click keeps it shut
 * until the pointer leaves the row.
 */
export function RowHoverCard({
  item,
  description,
  repoIcon,
  onOpen,
  children,
}: {
  item: SidebarItem;
  /** The item's first human message, when main has one. */
  description: string | null;
  /** The repo's chosen icon, for the card's repo tile. Null = letter. */
  repoIcon: RepoIcon | null;
  onOpen: (workItemId: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dismissedRef = useRef(false);
  const close = () => {
    dismissedRef.current = true;
    setOpen(false);
  };

  const glyph = getGitGlyph(item);
  const GlyphIcon = GLYPH_ICON[glyph.glyph];
  // A row stays silent about an unremarkable state; the card is where the
  // state is always spelled out, so it falls through to the bucket's own word.
  const status = getStatusWord(item) ?? {
    word: capitalizeStatusWord(getBucketWord(item.bucket)),
    signal: statusSignalForBucket(item.bucket),
  };
  const pr = item.pullRequest;
  const checks = pr?.checks ?? null;
  const ChecksIcon = checks ? CHECKS_ICON[checks] : null;

  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        if (next && dismissedRef.current) return;
        setOpen(next);
      }}
    >
      <HoverCardTrigger
        render={
          <div
            onClick={close}
            onContextMenu={close}
            onPointerLeave={() => {
              dismissedRef.current = false;
            }}
          />
        }
        delay={HOVER_DELAY_MS}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex items-start gap-2">
          <GlyphIcon
            className={cn('mt-0.5 size-icon-sm shrink-0', statusTextClass(glyph.signal))}
            strokeWidth={1.75}
          />
          <p className="line-clamp-2 min-w-0 flex-1 text-body tracking-body font-medium text-text">
            {item.name}
          </p>
        </div>

        <div className="ml-6 mt-1.5 flex flex-wrap items-center gap-1.5 text-tiny tracking-tiny text-text-muted">
          <span className={cn('flex items-center gap-1', statusTextClass(status.signal))}>
            <span className={cn('size-1.5 rounded-full', statusDotClass(status.signal))} />
            {status.word}
          </span>
          {item.branchName && (
            <>
              <span className="text-text-passive/50">·</span>
              <span className="truncate font-mono">{item.branchName}</span>
            </>
          )}
          <span className="text-text-passive/50">·</span>
          <RelativeTime value={item.updatedAt * 1000} compact ago />
        </div>

        {description && (
          <p className="ml-6 mt-2.5 line-clamp-3 text-tiny tracking-tiny text-text-passive">
            {description}
          </p>
        )}

        <div className="ml-6 mt-3 flex flex-wrap items-center gap-3 text-tiny tracking-tiny text-text-muted">
          {item.diffStats && item.diffStats.added + item.diffStats.removed > 0 && (
            <span className="font-mono tabular-nums">
              <span className="text-diff-add">+{item.diffStats.added}</span>{' '}
              <span className="text-diff-del">-{item.diffStats.removed}</span>
            </span>
          )}
          {pr && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                close();
                void rpc.app.openExternal(pr.url);
              }}
              className="flex items-center gap-1 text-text-muted transition-colors hover:text-text hover:underline"
            >
              <GitBranch className="size-icon-xs" strokeWidth={1.75} />#{pr.number}
              <ExternalLink className="size-icon-xs" strokeWidth={1.75} />
            </button>
          )}
          {checks && (
            <span className={cn('flex items-center gap-1', CHECKS_TONE[checks])}>
              {ChecksIcon && <ChecksIcon className="size-icon-xs" strokeWidth={1.75} />}
              {CHECKS_LABEL[checks]}
            </span>
          )}
          {item.worktreeCount > 1 && <span>{item.worktreeCount} worktrees</span>}
          {item.liveSessionCount > 0 && (
            <span className="flex items-center gap-1">
              <Waves className="size-icon-xs" strokeWidth={1.75} />
              {item.liveSessionCount} live
            </span>
          )}
          {item.devServerUrl && <span className="text-status-ok">{item.devServerUrl} running</span>}
          <span className="flex items-center gap-1">
            <RepoIdentityTile
              repoId={item.repoId}
              label={item.repoLabel}
              icon={repoIcon}
              className="size-icon-sm"
            />
            {item.repoLabel}
          </span>
        </div>

        <HoverCardAction item={item} onOpen={onOpen} onActed={close} />
      </HoverCardContent>
    </HoverCard>
  );
}
