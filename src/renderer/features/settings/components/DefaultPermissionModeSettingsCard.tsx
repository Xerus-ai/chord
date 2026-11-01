import type { AgentProviderDefinition, AgentProviderId } from '@shared/agent-provider-registry';
import { useAgentCatalog } from '@renderer/features/composer-controls/use-agent-catalog';
import { useInstalledAgents } from '@renderer/features/composer-controls/use-installed-agents';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { agentConfig } from '@renderer/utils/agentConfig';
import { SettingRow } from './SettingRow';

/** The select's value for "no saved default": the agent's own default mode. */
const AGENT_DEFAULT = '__agent-default__';

function AgentName({ providerId, name }: { providerId: AgentProviderId; name: string }) {
  const config = agentConfig[providerId];
  return (
    <span className="flex items-center gap-2">
      <AgentLogo
        logo={config.logo}
        alt={config.alt}
        isSvg={config.isSvg}
        invertInDark={config.invertInDark}
        className="size-4 shrink-0"
      />
      {name}
    </span>
  );
}

/**
 * One agent's default mode, chosen from the modes its catalog reports. An ACP
 * agent reports its modes when a session starts, so until one has run in
 * this app session there is nothing to choose from — the row says so rather
 * than guessing. Agents with no modes at all (PTY) get no row.
 */
function AgentDefaultModeRow({
  provider,
  saved,
  onPick,
  onClear,
  disabled,
}: {
  provider: AgentProviderDefinition;
  saved: string | undefined;
  onPick: (modeId: string) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const { catalog } = useAgentCatalog(provider.id);
  const modes = catalog?.permissionModes ?? [];
  if (modes.length === 0 && provider.communication !== 'acp') return null;
  const catalogDefault = modes.find((m) => m.isDefault);
  const agentDefaultLabel = `Agent default${catalogDefault ? ` (${catalogDefault.label})` : ''}`;
  // The trigger shows an item's label, not its value, only when told the labels.
  const items = [
    { value: AGENT_DEFAULT, label: agentDefaultLabel },
    ...modes.map((m) => ({ value: m.id, label: m.label })),
  ];

  return (
    <SettingRow
      title={<AgentName providerId={provider.id} name={provider.name} />}
      description={
        modes.length === 0
          ? `${provider.name} reports its modes when a session starts. Start one to choose.`
          : undefined
      }
      control={
        modes.length > 0 && (
          <Select
            value={saved ?? AGENT_DEFAULT}
            items={items}
            disabled={disabled}
            onValueChange={(next) => (next === AGENT_DEFAULT ? onClear() : onPick(next as string))}
          >
            <SelectTrigger className="w-auto shrink-0 gap-2 [&>span]:line-clamp-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-max">
              <SelectItem value={AGENT_DEFAULT}>{agentDefaultLabel}</SelectItem>
              {modes.map((m) => (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  className={m.danger ? 'text-status-err' : undefined}
                >
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    />
  );
}

/**
 * Settings › Agents & models › Default permission mode: per installed agent,
 * the mode a new chat session starts in. The composer's mode menu still
 * changes it per session; a running session keeps the mode it started in.
 */
export function DefaultPermissionModeSettingsCard() {
  const { value, isLoading, isSaving, update, resetField } = useAppSettingsKey(
    'agentDefaultPermissionModes'
  );
  const installed = useInstalledAgents();

  return (
    <div className="flex flex-col">
      <SettingRow
        title="Default permission mode"
        description="The mode a new chat session starts in. You can still change it for each session from the composer."
        control={null}
      />
      {installed.map((provider) => (
        <AgentDefaultModeRow
          key={provider.id}
          provider={provider}
          saved={value?.[provider.id]}
          onPick={(modeId) => update({ [provider.id]: modeId })}
          onClear={() => resetField(provider.id)}
          disabled={isLoading || isSaving}
        />
      ))}
    </div>
  );
}
