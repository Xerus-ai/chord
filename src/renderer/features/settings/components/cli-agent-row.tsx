import { ChevronDown, ChevronRight, FileText, Settings2, Sparkles, Terminal } from 'lucide-react';
import { useState } from 'react';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { AgentUpdateInfo } from '@shared/agent-updates';
import type { DetectedAgent, HarnessEntry } from '@shared/skills/types';
import { type CliAgentStatus } from '@renderer/features/settings/components/connections';
import IntegrationRow from '@renderer/features/settings/components/IntegrationRow';
import { AgentInstallButton } from '@renderer/lib/components/agent-selector/agent-install-button';
import { rpc } from '@renderer/lib/ipc';
import { agentMeta } from '@renderer/lib/providers/meta';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { log } from '@renderer/utils/logger';
import type { AgentUpdateFailure } from '../use-agent-updates';
import { AgentUpdateButton, AgentUpdateError, AgentVersion } from './agent-update-status';
import { describeHarnessCount } from './harness-count-label';

const ICON_BUTTON =
  'rounded-md p-1.5 text-text-muted transition hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected-border focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export type AgentRowActions = {
  isInstalling: (id: AgentProviderId) => boolean;
  onInstallClick: (agent: CliAgentStatus) => void;
  onSettingsClick: (id: string) => void;
  onUpdateClick: (update: AgentUpdateInfo, agentName: string) => void;
};

/** The agent's update state: its check result, whether it is updating, its last failure. */
export type AgentRowUpdate = {
  info: AgentUpdateInfo | undefined;
  isUpdating: boolean;
  failure: AgentUpdateFailure | undefined;
};

function HarnessDetails({ entries, label }: { entries: HarnessEntry[]; label: string }) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-1">
      <div className="section-header">
        {label} ({entries.length})
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {entries.map((entry) => (
          <span
            key={entry.name}
            className="inline-flex items-center gap-1 rounded bg-surface-inset px-1.5 py-0.5 text-tiny tracking-tiny text-text-muted"
          >
            {entry.type === 'command' ? (
              <Terminal className="h-2.5 w-2.5" />
            ) : (
              <FileText className="h-2.5 w-2.5" />
            )}
            {entry.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function SettingsButton({ agent, onClick }: { agent: CliAgentStatus; onClick: () => void }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onClick}
              className={ICON_BUTTON}
              aria-label={`${agent.name} execution settings`}
            />
          }
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-tiny tracking-tiny">
          Execution settings
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * One agent in Settings › Agents & models. The row is a group named after the
 * agent and carries its id (`data-agent-id`), so its version and Update button
 * can be found per agent (scripts/e2e/suites/agent-updates.mjs).
 */
export function AgentRow({
  agent,
  actions,
  harness,
  update,
}: {
  agent: CliAgentStatus;
  actions: AgentRowActions;
  harness: DetectedAgent | undefined;
  update: AgentRowUpdate;
}) {
  const [expanded, setExpanded] = useState(false);
  const logo = agentMeta[agent.id as keyof typeof agentMeta]?.icon;
  const providerId = isValidProviderId(agent.id) ? agent.id : null;

  const isDetectedByCli = agent.status === 'connected';
  const isDetectedByHarness = harness?.installed ?? false;
  const isDetected = isDetectedByCli || isDetectedByHarness;

  const harnessCount = (harness?.skills.length ?? 0) + (harness?.commands.length ?? 0);
  const hasHarnessDetails = harnessCount > 0;

  const handleNameClick = agent.docUrl
    ? async () => {
        try {
          await rpc.app.openExternal(agent.docUrl!);
        } catch (openError) {
          log.error(`Failed to open ${agent.name} docs:`, openError);
        }
      }
    : undefined;

  const indicatorClass = isDetected ? 'bg-status-ok' : 'bg-text-passive';
  const statusLabel = isDetected ? 'Detected' : 'Not detected';
  const updateInfo = update.info;

  return (
    <div role="group" aria-label={agent.name} data-agent-id={agent.id}>
      <IntegrationRow
        logoSrc={logo}
        icon={
          logo ? undefined : <Sparkles className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
        }
        name={agent.name}
        onNameClick={handleNameClick}
        status={agent.status === 'missing' && isDetectedByHarness ? 'connected' : agent.status}
        statusLabel={statusLabel}
        showStatusPill={false}
        installCommand={agent.installCommand}
        middle={
          <span className="flex items-center gap-2 text-body tracking-body text-text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${indicatorClass}`} />
            {statusLabel}
            {isDetectedByCli && agent.version ? (
              <AgentVersion installedVersion={agent.version} update={updateInfo} />
            ) : null}
            {hasHarnessDetails && (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
                className="ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 text-tiny tracking-tiny text-text-muted/70 transition hover:bg-surface-inset hover:text-text-muted"
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {describeHarnessCount(harness?.skills.length ?? 0, harness?.commands.length ?? 0)}
              </button>
            )}
          </span>
        }
        rightExtra={
          isDetected ? (
            <span className="flex items-center gap-1">
              <AgentUpdateButton
                agentName={agent.name}
                update={updateInfo}
                isUpdating={update.isUpdating}
                onUpdate={() => updateInfo && actions.onUpdateClick(updateInfo, agent.name)}
              />
              <SettingsButton agent={agent} onClick={() => actions.onSettingsClick(agent.id)} />
            </span>
          ) : providerId ? (
            <AgentInstallButton
              agentId={providerId}
              canInstall={!!agent.installCommand}
              isInstalled={isDetected}
              isInstalling={actions.isInstalling(providerId)}
              tooltipSide="top"
              onInstall={() => actions.onInstallClick(agent)}
            />
          ) : null
        }
      />
      {update.failure && (
        <div className="ml-10 mb-2">
          <AgentUpdateError
            agentName={agent.name}
            message={update.failure.message}
            output={update.failure.output}
          />
        </div>
      )}
      {expanded && harness && (
        <div className="ml-10 border-l border-border pl-3 pb-2">
          <HarnessDetails entries={harness.skills} label="Skills" />
          <HarnessDetails entries={harness.commands} label="Commands" />
        </div>
      )}
    </div>
  );
}
