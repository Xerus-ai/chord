import React from 'react';
import type { AppSettings } from '@shared/app-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Switch } from '@renderer/lib/ui/switch';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const GATES: Array<{
  field: keyof AppSettings['qualityGates'];
  title: string;
  description: string;
}> = [
  {
    field: 'requireReviewBeforeMerge',
    title: 'Require review before merge',
    description: 'A work item must have a completed review before it can be merged.',
  },
  {
    field: 'requirePassingTests',
    title: 'All tests must pass',
    description: 'Block merges while the work item has failing checks.',
  },
  {
    field: 'requirePlanningDoc',
    title: 'Planning doc required',
    description: 'A work item must link a planning document before implementation starts.',
  },
  {
    field: 'requireHumanApproval',
    title: 'Minimum 1 human approval',
    description: 'At least one teammate must approve, agent approvals do not count.',
  },
];

const QualityGatesCard: React.FC = () => {
  const {
    value: gates,
    defaults,
    update,
    isLoading,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('qualityGates');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-tiny tracking-tiny text-text-passive">
        Chord stores these preferences but does not block merges on them yet — they are recorded for
        your team, not enforced.
      </p>
      {GATES.map((gate) => (
        <SettingRow
          key={gate.field}
          title={gate.title}
          description={gate.description}
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden(gate.field)}
                defaultLabel={defaults?.[gate.field] ? 'on' : 'off'}
                onReset={() => resetField(gate.field)}
                disabled={isLoading}
              />
              <Switch
                checked={gates?.[gate.field] ?? false}
                disabled={isLoading}
                aria-label={gate.title}
                onCheckedChange={(next) => update({ [gate.field]: next })}
              />
            </>
          }
        />
      ))}
    </div>
  );
};

export default QualityGatesCard;
