import React from 'react';
import type { GitAiSettings } from '@shared/git-ai';
import { GitAiModelSelect, InstructionsTextarea } from '@renderer/features/git-ai/git-ai-fields';
import { useGitAiAgentOptions } from '@renderer/features/git-ai/use-git-ai-agent-options';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

const PR_DEFAULTS: readonly {
  key: keyof GitAiSettings['prDefaults'];
  title: string;
  description: string;
}[] = [
  {
    key: 'draft',
    title: 'Create as draft',
    description: 'Create PR starts with "Create as draft" ticked.',
  },
  {
    key: 'useTemplate',
    title: "Use the repository's PR template",
    description:
      'Create PR opens with the template (.github/pull_request_template.md and the other places GitHub reads it) in the description, and Generate follows it.',
  },
  {
    key: 'openAfterCreate',
    title: 'Open in browser after create',
    description: 'A new pull request opens in your browser once it is created.',
  },
];

/**
 * Settings › Git › AI (plan 2026-09-26 §Phase 3 slice 4): which of the user's
 * own agents writes commit messages and PR text, with which model and
 * instructions, and what Create PR starts with. A repository can set any of
 * these for itself (Repository settings › Git AI).
 */
const GitAiSettingsCard: React.FC = () => {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('gitAi');
  const options = useGitAiAgentOptions(value?.agent);
  if (!value) return null;
  const disabled = isLoading || isSaving;

  return (
    <div className="grid gap-6">
      <SettingRow
        title="Agent"
        description="Generate runs this agent once, with no tools, in an empty temporary folder, and saves no session to its history. ACP agents may keep their own record of the temporary session; it never shows up in a work item, because its folder is temporary."
        control={
          <SegmentedControl
            size="xs"
            ariaLabel="Git AI agent"
            options={options}
            value={value.agent}
            onChange={(agent) => update({ agent, model: null })}
          />
        }
      />
      <SettingRow
        title="Model"
        description="From the agent's own model list."
        control={
          <GitAiModelSelect
            agent={value.agent}
            value={value.model}
            disabled={disabled}
            onChange={(model) => update({ model })}
          />
        }
      />
      <div className="flex flex-col gap-2">
        <SettingRow
          title="Commit message instructions"
          description="Added to every commit message prompt."
          control={null}
        />
        <InstructionsTextarea
          label="Commit message instructions"
          value={value.instructions.commit}
          placeholder="e.g. Use Conventional Commits."
          disabled={disabled}
          onSave={(commit) => update({ instructions: { ...value.instructions, commit } })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <SettingRow
          title="Pull request instructions"
          description="Added to every pull request prompt."
          control={null}
        />
        <InstructionsTextarea
          label="Pull request instructions"
          value={value.instructions.pr}
          placeholder="e.g. Link the ticket in the first line."
          disabled={disabled}
          onSave={(pr) => update({ instructions: { ...value.instructions, pr } })}
        />
      </div>
      {PR_DEFAULTS.map((row) => (
        <SettingRow
          key={row.key}
          title={row.title}
          description={row.description}
          control={
            <Switch
              aria-label={row.title}
              checked={value.prDefaults[row.key]}
              disabled={disabled}
              onCheckedChange={(checked) =>
                update({ prDefaults: { ...value.prDefaults, [row.key]: checked } })
              }
            />
          }
        />
      ))}
    </div>
  );
};

export default GitAiSettingsCard;
