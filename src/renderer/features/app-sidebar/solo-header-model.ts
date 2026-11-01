import type { SoloView } from '@shared/solo';

/**
 * The sidebar repo header's Solo line (plan §"Decisions for Phase 4", Slot +
 * queue): "Soloing <work item>" (+ "· n queued"), which focuses the holder's
 * work item, or "Solo interrupted" with Restore. The holder is named by its
 * work item: lanes' branches share their prefix, so a branch cut off in the
 * sidebar never said which lane held the root (devstation-5b3.6). The
 * branch is in the hover.
 */
export interface SoloHeaderModel {
  text: string;
  /** "n queued", apart from `text`: a long work item name is cut, never the count. */
  queued: string | null;
  /** The hover: the whole line, with the holder's branch. */
  title: string;
  action: { kind: 'focus'; workItemId: string } | { kind: 'restore' };
}

export function describeSoloHeader(solo: SoloView | undefined): SoloHeaderModel | null {
  if (!solo) return null;
  if (solo.interrupted) {
    return {
      text: 'Solo interrupted',
      queued: null,
      title: 'Solo interrupted',
      action: { kind: 'restore' },
    };
  }
  if (!solo.holder) return null;
  const { workItemName, branch } = solo.holder;
  const queued = solo.queue.length > 0 ? `${solo.queue.length} queued` : null;
  return {
    text: `Soloing ${workItemName}`,
    queued,
    title: `Soloing ${workItemName}${branch ? ` on ${branch}` : ''}${queued ? ` · ${queued}` : ''}`,
    action: { kind: 'focus', workItemId: solo.holder.workItemId },
  };
}
