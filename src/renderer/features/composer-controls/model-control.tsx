import { formatForDisplay, type Hotkey } from '@tanstack/react-hotkeys';
import { Check, ChevronDown, Zap } from 'lucide-react';
import {
  effortsForModel,
  findCatalogModel,
  formatEffortLabel,
  type AgentControlCatalog,
  type CatalogSelection,
} from '@shared/agent-control-catalog';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Kbd } from '@renderer/lib/ui/kbd';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Switch } from '@renderer/lib/ui/switch';
import { agentConfig } from '@renderer/utils/agentConfig';
import { useAgentCatalog } from './use-agent-catalog';
import { useInstalledAgents } from './use-installed-agents';

function ProviderLogo({ providerId }: { providerId: AgentProviderId }) {
  const config = agentConfig[providerId];
  return (
    <AgentLogo
      logo={config.logo}
      alt={config.alt}
      isSvg={config.isSvg}
      invertInDark={config.invertInDark}
      className="size-3.5 shrink-0"
    />
  );
}

/** The effort a selection runs at, as the pill and menu name it; null = provider default. */
function selectedEffortLabel(catalog: AgentControlCatalog, selection: CatalogSelection) {
  const offered = effortsForModel(catalog, selection.model);
  const effort = offered.find((e) => e.id === selection.effort);
  return effort ? effort.label : null;
}

/**
 * The composer's one agent control, after the reference apps: a pill naming
 * the model, its effort and fast state, opening a menu that holds every choice
 * the provider's catalog offers — models, then effort and fast for the chosen
 * model, then the other installed agents. A running session's agent is fixed,
 * so picking another agent opens a new session with it instead.
 */
export function ModelControl({
  sessionId,
  agent,
  selection,
  onModelChange,
  onEffortChange,
  onFastChange,
  onOpenAgent,
  cycleEffortHotkey,
}: {
  sessionId: string;
  agent: AgentProviderId;
  selection: CatalogSelection;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: string | null) => void;
  onFastChange: (fast: boolean) => void;
  onOpenAgent: (providerId: AgentProviderId) => void;
  cycleEffortHotkey: Hotkey | null;
}) {
  const { catalog, error, isLoading, refresh } = useAgentCatalog(agent, sessionId);
  const installed = useInstalledAgents();
  const otherAgents = installed.filter((p) => p.id !== agent);
  const providerName = getProvider(agent)?.name ?? agent;

  const current = catalog ? findCatalogModel(catalog, selection.model) : undefined;
  const efforts = catalog ? effortsForModel(catalog, selection.model) : [];
  const effortLabel = catalog ? selectedEffortLabel(catalog, selection) : null;
  const fastOn = selection.fast && current?.supportsFast === true;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Model — ${current?.label ?? providerName}`}
        className="inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border-none bg-transparent px-2 text-tiny tracking-tiny text-text transition-colors hover:bg-surface-hover data-popup-open:bg-surface-hover"
      >
        <ProviderLogo providerId={agent} />
        <span className="truncate">{current?.label ?? providerName}</span>
        {effortLabel && <span className="text-text-muted">{effortLabel}</span>}
        {fastOn && <Zap className="size-3 fill-current text-text-muted" aria-label="Fast" />}
        {isLoading ? (
          <Spinner size="sm" className="size-3" />
        ) : (
          <ChevronDown className="size-3 text-text-muted" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        {error && (
          <div className="flex items-center gap-2 px-2 py-1.5 text-tiny tracking-tiny text-status-err">
            <span className="min-w-0 flex-1">Could not load {providerName} models</span>
            <button
              type="button"
              onClick={refresh}
              className="cursor-pointer rounded-sm border-none bg-transparent px-1 text-text-muted hover:text-text"
            >
              Retry
            </button>
          </div>
        )}
        {catalog?.models.map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => onModelChange(m.id)} title={m.description}>
            <ProviderLogo providerId={agent} />
            <span className="truncate">{m.label}</span>
            {m.id === current?.id && effortLabel && (
              <span className="text-tiny tracking-tiny text-text-muted">{effortLabel}</span>
            )}
            {m.id === current?.id && fastOn && (
              <Zap className="size-3 fill-current text-text-muted" />
            )}
            {m.id === current?.id && <Check className="ml-auto size-3.5" />}
          </DropdownMenuItem>
        ))}
        {catalog && catalog.models.length === 0 && efforts.length === 0 && (
          <div className="px-2 py-1.5 text-tiny tracking-tiny text-text-muted">
            {providerName} runs on its own default model
          </div>
        )}

        {(efforts.length > 1 || current?.supportsFast) && <DropdownMenuSeparator />}
        {efforts.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Effort
              <span className="ml-auto text-tiny tracking-tiny text-text-muted">
                {effortLabel ?? 'Default'}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuItem onClick={() => onEffortChange(null)}>
                Default
                {current?.defaultEffort && (
                  <span className="text-tiny tracking-tiny text-text-muted">
                    {formatEffortLabel(current.defaultEffort)}
                  </span>
                )}
                {effortLabel === null && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
              {efforts.map((e) => (
                <DropdownMenuItem key={e.id} onClick={() => onEffortChange(e.id)}>
                  {e.label}
                  {selection.effort === e.id && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {current?.supportsFast && (
          <DropdownMenuItem closeOnClick={false} onClick={() => onFastChange(!fastOn)}>
            <Zap className="size-3.5" />
            Fast
            <Switch size="sm" checked={fastOn} className="pointer-events-none ml-auto" />
          </DropdownMenuItem>
        )}

        {otherAgents.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-micro tracking-micro text-text-passive">
                New session with
              </DropdownMenuLabel>
              {otherAgents.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => onOpenAgent(p.id)}>
                  <ProviderLogo providerId={p.id} />
                  {p.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {efforts.length > 1 && cycleEffortHotkey && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-end gap-2 px-2 py-1 text-micro tracking-micro text-text-passive">
              <Kbd>{formatForDisplay(cycleEffortHotkey)}</Kbd>
              Cycle effort
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The level after `current` in `catalog`'s offer for the selected model, wrapping to Default. */
export function nextEffort(catalog: AgentControlCatalog, selection: CatalogSelection) {
  const ids = effortsForModel(catalog, selection.model).map((e) => e.id);
  if (ids.length < 2) return undefined;
  const at = selection.effort ? ids.indexOf(selection.effort) : -1;
  return at + 1 < ids.length ? ids[at + 1] : null;
}
