import type { WorktreeSourceVisibility } from '@shared/worktree-sources';
import { useInvalidateWorktreeSources } from '@renderer/features/app-sidebar/use-worktree-sources';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from '../components/SettingRow';
import {
  WORKTREE_SOURCE_ROWS,
  WORKTREE_VISIBILITY_OPTIONS,
} from '../components/WorktreeSourcesCard';
import { LayerBadge } from './layered-field';
import type { RepoSettingsData, useRepoSettings } from './use-repo-settings';

type SaveJustMe = ReturnType<typeof useRepoSettings>['saveJustMe'];
type Choice = WorktreeSourceVisibility | 'yours';

const OPTIONS: readonly { value: Choice; label: string }[] = [
  { value: 'yours', label: 'Your setting' },
  ...WORKTREE_VISIBILITY_OPTIONS,
];

/**
 * Repo › General › Worktree sources (plan §Phase 3 slice 6): this
 * repository's own choice, per source, over Settings › General, and whether
 * its "Review N worktrees" line shows at all ("Hide for this repo").
 */
export function RepoWorktreeSourcesRows({
  justMe,
  saveJustMe,
}: {
  justMe: RepoSettingsData['justMe'];
  saveJustMe: SaveJustMe;
}) {
  const invalidateSources = useInvalidateWorktreeSources();
  const save = async (patch: Parameters<SaveJustMe>[0]) => {
    if (await saveJustMe(patch)) invalidateSources();
  };

  return (
    <>
      {WORKTREE_SOURCE_ROWS.map((row) => {
        const own = justMe.worktreeSources?.[row.id];
        return (
          <SettingRow
            key={row.id}
            title={
              <span className="flex items-center gap-2">
                {row.title} <LayerBadge layer={own ? 'justMe' : 'default'} />
              </span>
            }
            description={row.description}
            control={
              <SegmentedControl
                size="xs"
                ariaLabel={row.title}
                options={OPTIONS}
                value={own ?? 'yours'}
                onChange={(next) =>
                  void save({ worktreeSources: { [row.id]: next === 'yours' ? null : next } })
                }
              />
            }
          />
        );
      })}
      <SettingRow
        title="Review line"
        description="Count this repository's hidden worktrees in a “Review N worktrees” line in the sidebar."
        control={
          <Switch
            checked={justMe.hideWorktreeReview !== true}
            onCheckedChange={(checked) => void save({ hideWorktreeReview: checked ? null : true })}
            aria-label="Review line"
          />
        }
      />
    </>
  );
}
