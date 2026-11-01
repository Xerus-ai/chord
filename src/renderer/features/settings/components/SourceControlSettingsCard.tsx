import React from 'react';
import type { CompareBaseMode, SourceControlGroupOrder } from '@shared/git-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const COMPARE_BASE_OPTIONS: readonly { value: CompareBaseMode; label: string }[] = [
  { value: 'repoDefault', label: 'Repository default' },
  { value: 'upstream', label: 'Branch upstream' },
];

const GROUP_ORDER_OPTIONS: readonly { value: SourceControlGroupOrder; label: string }[] = [
  { value: 'changes', label: 'Changes' },
  { value: 'staged', label: 'Staged' },
  { value: 'untracked', label: 'Untracked' },
];

/**
 * Settings › Git › Source control: what a lane's committed changes are counted
 * against — in the Changes panel and the sidebar's +/− alike — and which group
 * the Changes panel lists first.
 */
const SourceControlSettingsCard: React.FC = () => {
  const { value, update, isLoading, isSaving, isFieldOverridden, resetField } =
    useAppSettingsKey('git');
  if (!value) return null;
  const disabled = isLoading || isSaving;

  return (
    <div className="grid gap-6">
      <SettingRow
        title="Compare base"
        description="What committed changes are measured against. Repository default is where the lane merges; Branch upstream shows only what isn't pushed yet. Pull request targets don't change."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('compareBase')}
              defaultLabel="Repository default"
              onReset={() => resetField('compareBase')}
              disabled={disabled}
            />
            <SegmentedControl
              size="xs"
              ariaLabel="Compare base"
              options={COMPARE_BASE_OPTIONS}
              value={value.compareBase}
              onChange={(next) => update({ compareBase: next })}
            />
          </>
        }
      />
      <SettingRow
        title="Source control group order"
        description="Which group the Changes panel lists first. Conflicts always come first."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('sourceControlGroupOrder')}
              defaultLabel="Changes"
              onReset={() => resetField('sourceControlGroupOrder')}
              disabled={disabled}
            />
            <SegmentedControl
              size="xs"
              ariaLabel="Source control group order"
              options={GROUP_ORDER_OPTIONS}
              value={value.sourceControlGroupOrder}
              onChange={(next) => update({ sourceControlGroupOrder: next })}
            />
          </>
        }
      />
    </div>
  );
};

export default SourceControlSettingsCard;
