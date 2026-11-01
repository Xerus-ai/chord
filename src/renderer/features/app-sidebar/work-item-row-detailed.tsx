import { formatForDisplay, type Hotkey } from '@tanstack/react-hotkeys';
import { DiffPill } from '@renderer/lib/components/diff-counts';
import { getStatusWord } from './row-presentation';
import type { SidebarItem } from './sidebar-projection';
import {
  ArtifactCount,
  CompareCueText,
  MetaFacts,
  RowTitle,
  StatusWordText,
} from './work-item-row-parts';

/**
 * Detailed — the prototype's `rowA`. Two lines whatever the row's state:
 * title with a bordered diff pill, then branch and the one coloured status
 * word, with the jump hint on the right for the rows the shortcut can
 * actually reach.
 *
 * The modifier is formatted by the same helper the New work item button
 * uses, so a Mac reads ⌘ and a Windows machine reads Ctrl without either
 * being written down here.
 */
export function WorkItemRowDetailed({
  item,
  showDiffStat,
  reason,
  jumpIndex,
}: {
  item: SidebarItem;
  showDiffStat: boolean;
  reason: string | null;
  /** 1-based position among the visible rows, or null past the ninth. */
  jumpIndex: number | null;
}) {
  const status = getStatusWord(item);
  const diff = item.diffStats;

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex h-[18px] items-center gap-1.5">
        <RowTitle item={item} />
        {showDiffStat && diff && diff.added + diff.removed > 0 && (
          <DiffPill added={diff.added} removed={diff.removed} />
        )}
        {/* No count to pill: why, in the pill's place (devstation-ama). */}
        {showDiffStat && item.compareCue && <CompareCueText cue={item.compareCue} />}
      </span>
      <span className="flex h-[15px] items-center gap-1.5 overflow-hidden text-list-meta text-text-passive">
        <MetaFacts
          parts={[
            item.sharedArtifacts ? (
              <ArtifactCount count={item.sharedArtifacts.length} />
            ) : (
              (item.branchName ?? item.repoLabel)
            ),
            (status || reason) && <StatusWordText status={status} reason={reason} />,
          ]}
        />
        {jumpIndex !== null && (
          <span className="ml-auto shrink-0 pl-1.5 font-mono tracking-tiny">
            {formatForDisplay(`Mod+${jumpIndex}` as Hotkey)}
          </span>
        )}
      </span>
    </span>
  );
}
