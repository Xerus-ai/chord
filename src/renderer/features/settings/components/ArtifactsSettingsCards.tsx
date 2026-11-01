import React from 'react';
import {
  AUTHORED_ARTIFACT_FORMAT_META,
  AUTHORED_ARTIFACT_FORMATS,
  type PreferredArtifactFormat,
} from '@shared/artifact-formats';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

// The section band (SettingsPage) is the container; cards only pad.
const CARD = '';

/** Settings › Agents › Artifacts — "Let agents create artifacts" (plan 2026-09-23 §3). */
export function ArtifactsSettingsCard() {
  const { value, isLoading, isFieldOverridden, resetField, update } =
    useAppSettingsKey('artifacts');

  return (
    <div className={cn(CARD, 'py-3')}>
      <SettingRow
        title="Let agents create artifacts"
        description={
          <>
            Agents can save plans, reports and prototypes as artifacts your team can read, comment
            on and edit. Turning this off keeps existing artifacts available. Claude Code&apos;s own
            artifacts are turned off in Chord sessions.
          </>
        }
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('enabled')}
              defaultLabel="on"
              onReset={() => resetField('enabled')}
              disabled={isLoading}
            />
            <Switch
              checked={value?.enabled ?? false}
              disabled={isLoading || !value}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </>
        }
      />
      <div className="mt-4 border-t border-border-subtle pt-4">
        <SettingRow
          title="Ask before deleting a shared artifact"
          description="Deleting breaks the link for everyone who has it."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('confirmDeleteShared')}
                defaultLabel="on"
                onReset={() => resetField('confirmDeleteShared')}
                disabled={isLoading}
              />
              <Switch
                checked={value?.confirmDeleteShared ?? true}
                disabled={isLoading || !value}
                onCheckedChange={(confirmDeleteShared) => update({ confirmDeleteShared })}
              />
            </>
          }
        />
      </div>
    </div>
  );
}

function EditingLevelPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-surface-inset px-2 py-0.5 text-tiny tracking-tiny text-text-muted">
      {children}
    </span>
  );
}

function FormatRow({
  value,
  selected,
  label,
  description,
  technicalName,
  pill,
}: {
  value: PreferredArtifactFormat;
  selected: boolean;
  label: string;
  description: string;
  technicalName?: string;
  pill?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 border px-3.5 py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg',
        selected
          ? 'border-selected-border bg-selected-bg'
          : 'border-transparent hover:bg-surface-inset [&+&]:border-t-border-subtle'
      )}
    >
      <RadioGroupItem value={value} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-body tracking-body text-text">{label}</div>
        <div className="text-tiny tracking-tiny text-text-muted">{description}</div>
        {technicalName && (
          <div className="text-tiny tracking-tiny text-text-muted">{technicalName}</div>
        )}
      </div>
      {pill && <EditingLevelPill>{pill}</EditingLevelPill>}
    </label>
  );
}

/**
 * Settings › Agents › Artifacts — "Preferred format". The choice reaches the
 * agent through the `publish_artifact` tool description; "Best fit" adds no
 * preference. Canvas gets a row when it renders (§2.2).
 */
export function PreferredFormatSettingsCard() {
  const { value, isLoading, isFieldOverridden, resetField, update } =
    useAppSettingsKey('artifacts');
  const preferred = value?.preferredFormat;

  return (
    <div className={cn(CARD, 'flex flex-col gap-3 py-3')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-tiny tracking-tiny text-text-muted">
          Agents use this unless you ask for something else.
        </p>
        <ResetToDefaultButton
          visible={isFieldOverridden('preferredFormat')}
          defaultLabel="Best fit"
          onReset={() => resetField('preferredFormat')}
          disabled={isLoading}
        />
      </div>
      <RadioGroup
        aria-label="Preferred artifact format"
        value={preferred ?? ''}
        disabled={isLoading || !value}
        onValueChange={(next) => update({ preferredFormat: next as PreferredArtifactFormat })}
        className="gap-0"
      >
        <FormatRow
          value="best-fit"
          selected={preferred === 'best-fit'}
          label="Best fit (Recommended)"
          description="The agent picks the format that suits the content."
        />
        {AUTHORED_ARTIFACT_FORMATS.map((format) => {
          const meta = AUTHORED_ARTIFACT_FORMAT_META[format];
          return (
            <FormatRow
              key={format}
              value={format}
              selected={preferred === format}
              label={meta.label}
              description={meta.description}
              technicalName={meta.technicalName}
              pill={meta.editing}
            />
          );
        })}
      </RadioGroup>
    </div>
  );
}
