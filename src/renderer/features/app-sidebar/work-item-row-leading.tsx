import { Loader2, TriangleAlert } from 'lucide-react';
import type { WorkItemStatusBucket } from '@shared/work-item-status';
import { MemberAvatar } from '@renderer/features/dashboard/member-avatar';
import { GLYPH_ICON } from '@renderer/lib/components/git-glyph';
import { ProviderTile } from '@renderer/lib/components/provider-tile';
import { statusDotClass, statusSignalForBucket, statusTextClass } from '@renderer/lib/status-dot';
import { cn } from '@renderer/utils/utils';
import { getGitGlyph } from './row-presentation';
import type { SidebarItem, SidebarView } from './sidebar-projection';

/** Buckets at rest show no dot — a dot on every row says nothing. */
function hasStatusDot(bucket: WorkItemStatusBucket): boolean {
  return bucket !== 'idle' && bucket !== 'done';
}

/** The prototype's `.glyph.working` ring: one arc orbiting the git glyph. */
function WorkingRing() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-0.5 animate-spin rounded-full border-[1.5px] border-transparent border-t-status-running"
    />
  );
}

function GitGlyphVisual({ item }: { item: SidebarItem }) {
  const { glyph, signal } = getGitGlyph(item);
  const Icon = GLYPH_ICON[glyph];
  return (
    <>
      <Icon className={cn('size-icon-sm', statusTextClass(signal))} strokeWidth={1.75} />
      {item.bucket === 'working' && <WorkingRing />}
    </>
  );
}

/**
 * Status view leads with the agent, not with git: the provider's own logo on
 * a tile, with the row's status dot notched into its corner. A row whose
 * provider is unknown keeps the git glyph rather than borrowing a logo.
 */
function ProviderTileVisual({ item }: { item: SidebarItem }) {
  return (
    <ProviderTile
      providerId={item.providerId}
      dot={
        hasStatusDot(item.bucket) && (
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-surface-canvas',
              statusDotClass(statusSignalForBucket(item.bucket)),
              item.bucket === 'working' && 'animate-pulse'
            )}
          />
        )
      }
    />
  );
}

/**
 * A row's leading 18px slot. Provisioning outranks everything — a workspace
 * that is still being cut has no git state and no agent to show. A
 * teammate's row leads with its owner's avatar (shared-items design §5): the
 * one thing that tells it apart from the user's own.
 */
export function WorkItemRowLeading({ item, view }: { item: SidebarItem; view: SidebarView }) {
  return (
    <span className="relative flex size-[18px] shrink-0 items-center justify-center">
      {item.provisionStatus === 'provisioning' ? (
        <Loader2 className="size-icon-xs animate-spin text-text-passive" />
      ) : item.provisionStatus === 'failed' ? (
        <TriangleAlert className="size-icon-xs text-status-warn" />
      ) : item.owner ? (
        <span className="flex" title={`Shared by ${item.owner.name}`}>
          <MemberAvatar name={item.owner.name} avatarUrl={item.owner.avatarUrl} size="xs" />
        </span>
      ) : view === 'status' && item.providerId ? (
        <ProviderTileVisual item={item} />
      ) : (
        <GitGlyphVisual item={item} />
      )}
    </span>
  );
}
