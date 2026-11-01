import { isValidProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { agentConfig } from '@renderer/utils/agentConfig';

/** What a teammate's composer shows of the owner's chat (session registry). */
export interface OwnerAgent {
  agentProviderId: string | null;
  modelLabel: string | null;
  permissionModeLabel: string | null;
}

const PILL =
  'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border-none bg-transparent px-2 text-tiny tracking-tiny text-text-muted disabled:cursor-default';

/**
 * The owner's agent, model and permission mode in a teammate's composer,
 * where the owner's own composer has its pickers (user decision 2026-10-01).
 * Disabled: only the owner changes them, on their machine. A label the
 * owner's app could not name is left out rather than guessed.
 */
export function OwnerAgentPills({ owner }: { owner: OwnerAgent }) {
  const providerId = isValidProviderId(owner.agentProviderId) ? owner.agentProviderId : null;
  const agent = providerId ? agentConfig[providerId] : null;
  const agentName = providerId ? (getProvider(providerId)?.name ?? providerId) : null;
  const ownerOnly = 'Only the owner changes this';
  return (
    <div data-testid="composer-owner-agent" className="flex min-w-0 items-center gap-0.5">
      {(agentName || owner.modelLabel) && (
        <button type="button" disabled className={PILL} title={ownerOnly}>
          {agent && (
            <AgentLogo
              logo={agent.logo}
              alt={agent.alt}
              isSvg={agent.isSvg}
              invertInDark={agent.invertInDark}
              className="size-icon-sm"
            />
          )}
          {agentName && <span className="truncate">{agentName}</span>}
          {owner.modelLabel && <span className="truncate">{owner.modelLabel}</span>}
        </button>
      )}
      {owner.permissionModeLabel && (
        <button type="button" disabled className={PILL} title={ownerOnly}>
          <span className="truncate">{owner.permissionModeLabel}</span>
        </button>
      )}
    </div>
  );
}
