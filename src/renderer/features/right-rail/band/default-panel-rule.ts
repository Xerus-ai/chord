import type { RailPanelId } from '../rail-store';

export interface DefaultPanelInput {
  workItemId: string;
  /** Whether the work item's tree state is known yet. */
  ready: boolean;
  isDirty: boolean;
  /** The rail store's count of tabs picked by hand (`handPicks`). */
  handPicks: number;
}

export interface DefaultPanelRule {
  /** The tab to switch to now, or null to leave the rail as it is. */
  decide(input: DefaultPanelInput): RailPanelId | null;
}

/**
 * Which tab a work item opens on: Changes while its tree is dirty, Work item
 * otherwise.
 *
 * A dirty tree is the one state where the user almost certainly came to look
 * at the diff; every other state is a question about the work item, which the
 * map answers. The rule applies once per work item, when its state is first
 * known, and never fights the user: a tab picked by hand since the work item
 * opened — before its state arrived, too — wins.
 */
export function createDefaultPanelRule(): DefaultPanelRule {
  let opened: { workItemId: string; handPicks: number } | null = null;
  let appliedFor: string | null = null;

  return {
    decide({ workItemId, ready, isDirty, handPicks }) {
      if (opened?.workItemId !== workItemId) opened = { workItemId, handPicks };
      if (!ready || appliedFor === workItemId) return null;
      appliedFor = workItemId;
      if (handPicks !== opened.handPicks) return null;
      return isDirty ? 'source-control' : 'work-item';
    },
  };
}
