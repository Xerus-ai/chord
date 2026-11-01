import React from 'react';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import type { McpProvidersResponse } from '@shared/mcp/types';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';

interface ProviderSelectProps {
  providers: McpProvidersResponse[];
  selectedProviders: string[];
  transport: 'stdio' | 'http';
  onToggle: (id: string) => void;
}

export const ProviderSelect: React.FC<ProviderSelectProps> = ({
  providers,
  selectedProviders,
  transport,
  onToggle,
}) => {
  const selectedProviderIds = new Set(selectedProviders);

  return (
    <Field>
      <FieldLabel>Sync to agents</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {providers
          .filter((p) => p.installed)
          .map((p) => {
            const unsupported = transport === 'http' && !p.supportsHttp;
            const selected = selectedProviderIds.has(p.id);
            const logo = agentConfig[p.id as AgentProviderId];
            return (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={unsupported}
                aria-pressed={selected}
                onClick={() => onToggle(p.id)}
                title={unsupported ? `${p.name} does not support HTTP servers` : undefined}
                className={cn(
                  'gap-1.5 border transition-[border-color,background-color,color,box-shadow]',
                  unsupported &&
                    'cursor-not-allowed border-border/70 bg-surface text-text-muted/40 shadow-none',
                  !unsupported &&
                    selected &&
                    'border-selected-border bg-selected-bg text-text ring-1 ring-selected-border/30 shadow-sm hover:border-selected-border hover:bg-selected-bg hover:text-text',
                  !unsupported &&
                    !selected &&
                    'border-border/85 bg-surface text-text-muted hover:border-selected-border/45 hover:bg-surface-raised/70 hover:text-text'
                )}
              >
                {logo && (
                  <AgentLogo
                    logo={logo.logo}
                    alt={logo.alt}
                    isSvg={logo.isSvg}
                    invertInDark={logo.invertInDark}
                    className="h-4 w-4 rounded-sm"
                    grayscale={unsupported}
                  />
                )}
                {p.name}
              </Button>
            );
          })}
      </div>
      {transport === 'http' && providers.some((p) => p.installed && !p.supportsHttp) && (
        <p className="mt-1.5 text-tiny tracking-tiny text-text-muted">
          Some agents don't support HTTP servers and are disabled.
        </p>
      )}
    </Field>
  );
};
