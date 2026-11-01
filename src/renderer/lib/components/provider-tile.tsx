import { Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { findAgentInfo } from '@renderer/utils/agentConfig';
import AgentLogo from './agent-logo';

/**
 * An agent provider as a leading visual: its own logo on a tile, with an
 * optional status dot notched into the corner.
 *
 * A row whose provider is unknown wears a terminal glyph rather than borrowing
 * another agent's logo. The dot is passed in rather than derived here — the
 * sidebar notches a work item's bucket, the rail notches a session's own
 * state, and this component has no business knowing either vocabulary.
 */
export function ProviderTile({ providerId, dot }: { providerId: string | null; dot?: ReactNode }) {
  const agent = providerId ? findAgentInfo(providerId) : null;

  return (
    <>
      <span className="flex size-icon-md items-center justify-center rounded-sm bg-surface-inset">
        {agent ? (
          <AgentLogo
            logo={agent.logo}
            alt={agent.alt}
            isSvg={agent.isSvg}
            invertInDark={agent.invertInDark}
            className="size-icon-xs"
          />
        ) : (
          <Terminal className="size-icon-xs text-text-muted" strokeWidth={1.75} />
        )}
      </span>
      {dot}
    </>
  );
}
