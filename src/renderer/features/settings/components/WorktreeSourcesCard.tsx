import React from 'react';
import type { WorktreeSourceId, WorktreeSourceVisibility } from '@shared/worktree-sources';
import { useInvalidateWorktreeSources } from '@renderer/features/app-sidebar/use-worktree-sources';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

export const WORKTREE_VISIBILITY_OPTIONS: readonly {
  value: WorktreeSourceVisibility;
  label: string;
}[] = [
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
];

export const WORKTREE_SOURCE_ROWS: readonly {
  id: WorktreeSourceId;
  title: string;
  description: string;
}[] = [
  {
    id: 'claudeCode',
    title: 'Claude Code worktrees',
    description: 'Checkouts Claude Code made, in a repository’s .claude/worktrees folder.',
  },
  {
    id: 'other',
    title: 'Other worktrees',
    description: 'Any other checkout of a repository that Chord did not make.',
  },
];

/**
 * Settings › General › Worktree sources (plan §Phase 3 slice 6): which
 * checkouts made outside Chord are listed under their repository with Adopt,
 * and which are only counted in its "Review N worktrees" line. A repository
 * can choose otherwise on its page.
 */
const WorktreeSourcesCard: React.FC = () => {
  const { value, update, isLoading, isSaving, isFieldOverridden, resetField } =
    useAppSettingsKey('worktreeSources');
  const invalidateSources = useInvalidateWorktreeSources();
  if (!value) return null;
  const disabled = isLoading || isSaving;

  return (
    <div className="flex flex-col">
      {WORKTREE_SOURCE_ROWS.map((row) => (
        <SettingRow
          key={row.id}
          title={row.title}
          description={row.description}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden(row.id)}
                onReset={() => resetField(row.id)}
                disabled={disabled}
              />
              <SegmentedControl
                size="xs"
                ariaLabel={row.title}
                options={WORKTREE_VISIBILITY_OPTIONS}
                value={value[row.id]}
                onChange={(next) => update({ [row.id]: next }, { onSuccess: invalidateSources })}
              />
            </>
          }
        />
      ))}
    </div>
  );
};

export default WorktreeSourcesCard;
