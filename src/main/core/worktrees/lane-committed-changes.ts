import type { LaneCommittedChanges } from '@shared/git-settings';
import { appSettingsService } from '@main/core/settings/settings-service';
import {
  readLaneCommittedChanges,
  resolveLaneCompareBase,
} from '@main/core/work-items/lane-compare-base';
import { resolveWorkItemBranchInfo } from '@main/core/work-items/resolve-branch-info';
import type { WorkItemWorktreeRow } from '@main/db/schema-work-items';

/**
 * The Changes panel's committed view for one lane: what its commits changed
 * against the base Settings › Git › Compare base names — the lane's target, or
 * its branch's upstream. The same resolution the sidebar's +/− uses, so the
 * two never disagree about what "changed" means.
 */
export async function readWorktreeCommittedChanges(
  row: WorkItemWorktreeRow
): Promise<LaneCommittedChanges> {
  const { compareBase: mode } = await appSettingsService.get('git');
  const branchInfo = await resolveWorkItemBranchInfo(row.path);
  const base = await resolveLaneCompareBase(
    {
      worktreePath: row.path,
      branchName: row.branchName,
      targetRef: row.targetRef,
      branchInfo,
    },
    mode
  );
  if (base.kind === 'no_upstream') return base;
  return { ...base, changes: await readLaneCommittedChanges(row.path, base) };
}
