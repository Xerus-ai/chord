import type { AppSettings } from '@shared/app-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { cn } from '@renderer/utils/utils';
import { ResetToDefaultButton } from './ResetToDefaultButton';

type OpenAgentsIn = AppSettings['agentLaunch']['openAgentsIn'];

const OPTIONS: readonly { value: OpenAgentsIn; label: string; description: string }[] = [
  {
    value: 'chat',
    label: 'Chat',
    description: 'Opens a chat with the agent, with its tools, permissions and artifacts.',
  },
  {
    value: 'terminal',
    label: 'Terminal',
    description: "Opens the agent's own CLI in a terminal in the work item's checkout.",
  },
];

/** Agents & models › Open agents in: what an agent row in a work item's `+` menu opens. */
export function AgentLaunchSettingsCard() {
  const { value, isLoading, isFieldOverridden, resetField, update } =
    useAppSettingsKey('agentLaunch');
  const selected = value?.openAgentsIn ?? 'chat';

  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-body tracking-body text-text">Open agents in</span>
          <span className="text-tiny tracking-tiny text-text-passive">
            What Claude, Codex and the other agents in a work item&apos;s + menu open.
          </span>
        </span>
        <ResetToDefaultButton
          visible={isFieldOverridden('openAgentsIn')}
          defaultLabel="Chat"
          onReset={() => resetField('openAgentsIn')}
          disabled={isLoading}
        />
      </div>
      <RadioGroup
        value={selected}
        onValueChange={(next) => update({ openAgentsIn: next as OpenAgentsIn })}
        disabled={isLoading || !value}
        className="gap-0"
      >
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 border px-3.5 py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg',
              selected === option.value
                ? 'border-selected-border bg-selected-bg'
                : 'border-border-subtle hover:bg-surface-hover'
            )}
          >
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-body tracking-body text-text">{option.label}</span>
              <span className="text-tiny tracking-tiny text-text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
