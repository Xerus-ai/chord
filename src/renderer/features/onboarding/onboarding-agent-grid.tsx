import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type AgentProviderDefinition,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import type { DependencyStatusMap } from '@shared/dependencies';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { FOCUS_RING } from '@renderer/lib/ui/focus-ring';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { OnboardingSection, RowSkeleton, RowTag, SectionFooter } from './onboarding-section';
import { partitionAgents } from './onboarding-state';

const DETECTABLE_AGENTS = AGENT_PROVIDERS.filter(
  (p) => p.detectable !== false && p.commands?.length
);

function ProviderLogo({ id, className }: { id: AgentProviderId; className: string }) {
  const config = agentConfig[id];
  return (
    <AgentLogo
      logo={config.logo}
      alt={config.alt}
      isSvg={config.isSvg}
      invertInDark={config.invertInDark}
      className={className}
    />
  );
}

function describeScan(scanning: boolean, found: number): string {
  if (scanning) return 'Looking for coding agents on this machine…';
  if (found === 0) return 'No coding agents found on this machine.';
  return `Found ${found} on this machine. New work items start with the one you pick.`;
}

/**
 * The default-agent step. Detected providers are a radio list; the rest of
 * the registry collapses into one row and opens in place as a dense picker —
 * with 24 providers, "which of these do I actually have?" has to be answerable
 * from position, not from a dot on a card. Picking commits immediately, and
 * the step is done as soon as the scan finishes (a machine with no agent CLI
 * must still reach the app; agents install from Settings).
 */
export function OnboardingAgentSection({
  index,
  isNext,
  scanning,
  detectedAgents,
  selectedAgent,
  onSelect,
  detectionError,
  localDependencies,
}: {
  index: number;
  isNext: boolean;
  scanning: boolean;
  detectedAgents: AgentProviderDefinition[];
  selectedAgent: AgentProviderId | null;
  onSelect: (id: AgentProviderId) => void;
  detectionError: string | null;
  /** The CLI probe results, for the installed version shown under each name. */
  localDependencies: DependencyStatusMap | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const { onMachine, installable } = useMemo(
    () => partitionAgents(detectedAgents, DETECTABLE_AGENTS),
    [detectedAgents]
  );

  // With nothing detected the installable list IS the choice, so it is open.
  const showInstallable = expanded || (!scanning && onMachine.length === 0);

  // Choosing an agent this machine doesn't have is allowed — `defaultAgent` is
  // persisted either way — but leaving that unsaid would imply Chord can run it.
  const pendingInstall = selectedAgent
    ? (installable.find((p) => p.id === selectedAgent) ?? null)
    : null;

  const footer = detectionError ? (
    <SectionFooter tone="error">{detectionError}</SectionFooter>
  ) : pendingInstall ? (
    <SectionFooter>
      <span>
        <span className="font-medium text-text-muted">{agentConfig[pendingInstall.id].name}</span>{' '}
        isn't installed yet — it becomes your default once you install it.
      </span>
    </SectionFooter>
  ) : !scanning && onMachine.length === 0 ? (
    <SectionFooter>Pick one to set as default, or install one from Settings later.</SectionFooter>
  ) : undefined;

  return (
    <OnboardingSection
      index={index}
      isNext={isNext}
      title="Default agent"
      meta={{ kind: 'label', label: 'Auto-detected' }}
      description={describeScan(scanning, onMachine.length)}
      state={scanning ? 'pending' : detectionError ? 'error' : 'done'}
      answer={
        selectedAgent && (
          <span className="font-medium text-text-muted">{agentConfig[selectedAgent].name}</span>
        )
      }
      footer={footer}
    >
      {scanning ? (
        <>
          <RowSkeleton />
          <RowSkeleton />
        </>
      ) : (
        <>
          {onMachine.length > 0 && (
            <RadioGroup
              aria-label="Default agent"
              value={selectedAgent ?? ''}
              onValueChange={(value) => onSelect(value as AgentProviderId)}
              className="gap-0"
            >
              {onMachine.map((p) => (
                <label
                  key={p.id}
                  className="flex min-h-14 cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-hover [&+&]:border-t [&+&]:border-border-subtle"
                >
                  <ProviderLogo id={p.id} className="size-7.5 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-body tracking-body font-medium text-text">
                      {agentConfig[p.id].name}
                      {selectedAgent === p.id && <RowTag>Default</RowTag>}
                    </div>
                    {p.cli && (
                      <div className="truncate font-mono text-tiny tracking-tiny text-text-passive">
                        {[p.cli, localDependencies?.[p.id]?.version].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <RadioGroupItem value={p.id} />
                </label>
              ))}
            </RadioGroup>
          )}
          {onMachine.length > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
              className={cn(
                'flex h-10 w-full items-center gap-2 border-t border-border-subtle px-3.5 text-tiny tracking-tiny font-medium text-text-passive transition-colors hover:bg-surface-hover hover:text-text',
                FOCUS_RING
              )}
            >
              {expanded ? 'Hide' : 'Show'} {installable.length} more supported agents
              <ChevronDown
                className={cn(
                  'ml-auto size-icon-sm transition-transform',
                  expanded && 'rotate-180'
                )}
              />
            </button>
          )}
          {showInstallable && (
            <div
              className={cn(
                'grid grid-cols-3 gap-0.5 p-1.5',
                onMachine.length > 0 && 'border-t border-border-subtle'
              )}
            >
              {installable.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={selectedAgent === p.id}
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    'flex h-8 items-center gap-2 rounded-md px-2 text-left text-tiny tracking-tiny transition-colors',
                    selectedAgent === p.id
                      ? 'bg-surface-active text-text'
                      : 'text-text-muted hover:bg-surface-hover',
                    FOCUS_RING
                  )}
                >
                  <ProviderLogo id={p.id} className="size-5 shrink-0 rounded-sm" />
                  <span className="truncate">{agentConfig[p.id].name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </OnboardingSection>
  );
}
