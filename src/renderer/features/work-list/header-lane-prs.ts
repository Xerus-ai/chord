import type { LaneChecksState, LanePullRequest } from '@shared/lane-pull-requests';
import { toLanePrState } from '@renderer/features/right-rail/band/lane-band-input';

/** One lane's pull request as the work item header lists it. Clicking it focuses the lane. */
export interface LanePrChip {
  worktreeId: string;
  branchName: string | null;
  number: number;
  url: string;
  state: 'open' | 'draft' | 'merged' | 'closed';
  checks: LaneChecksState;
  focused: boolean;
}

/** Every lane's PR, in lane order (primary first); lanes without a PR have no chip. */
export function listLanePrChips(
  lanes: readonly LanePullRequest[],
  focusedWorktreeId: string | null
): LanePrChip[] {
  return lanes.flatMap((lane) => {
    const state = toLanePrState(lane.pr);
    if (!lane.pr || !state) return [];
    return [
      {
        worktreeId: lane.worktreeId,
        branchName: lane.branchName,
        number: lane.pr.number,
        url: lane.pr.url,
        state,
        checks: lane.pr.checks,
        focused: lane.worktreeId === focusedWorktreeId,
      },
    ];
  });
}
