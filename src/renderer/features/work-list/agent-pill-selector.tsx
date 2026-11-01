import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import { dependenciesStore } from '@renderer/lib/stores/app-state';
import { useResourceData } from '@renderer/lib/stores/use-resource';

export function AgentPillSelector({
  selected,
  onSelect,
}: {
  selected: AgentProviderId;
  onSelect: (id: AgentProviderId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const provider = AGENT_PROVIDERS.find((p) => p.id === selected);

  const { data: localData } = useResourceData(dependenciesStore.local);
  const visibleProviders = useMemo(() => {
    const installedIds = new Set(
      Object.entries(localData ?? {})
        .filter(([, s]) => s.status === 'available' && s.category === 'agent')
        .map(([id]) => id)
    );
    installedIds.add(selected);
    return AGENT_PROVIDERS.filter((p) => installedIds.has(p.id));
  }, [localData, selected]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <span
        onClick={() => setOpen(!open)}
        className="inline-flex cursor-pointer items-center rounded-full bg-action-bg px-2 py-1 text-tiny tracking-tiny font-semibold text-action-fg transition-colors hover:bg-action-bg-hover"
      >
        {provider?.name ?? selected}
        <ChevronDown className="ml-[3px] h-[10px] w-[10px]" />
      </span>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[280px] w-[200px] overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface py-1 shadow-lg">
          {visibleProviders.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                onSelect(a.id);
                setOpen(false);
              }}
              className={`flex w-full cursor-pointer items-center gap-2 border-none px-3 py-2 text-left text-tiny tracking-tiny transition-colors hover:bg-surface-raised ${
                a.id === selected ? 'bg-selected-bg text-text' : 'bg-transparent text-text-muted'
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
