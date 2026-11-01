import { Sparkles, SquareSlash } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderSlashCommand } from '@shared/skills/types';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';

export function SlashCommandMenu({
  query,
  providerId,
  workItemId,
  onSelect,
  onClose,
  visible,
  placement,
}: {
  query: string;
  providerId: AgentProviderId;
  workItemId?: string;
  onSelect: (command: string) => void;
  onClose: () => void;
  visible: boolean;
  /**
   * Which way the list opens away from the composer. The chat composer sits at
   * the bottom of its panel and opens up; the dashboard composer sits near the
   * top of the page, where opening up would run the list off-screen.
   */
  placement: 'above' | 'below';
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [commands, setCommands] = useState<ProviderSlashCommand[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // The list comes from the selected agent's real config dirs (global +
  // project), so it always matches what the running agent can execute.
  useEffect(() => {
    let stale = false;
    rpc.skills
      .listProviderCommands({ providerId, workItemId })
      .then((result) => {
        if (!stale && result.success) setCommands(result.data);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [providerId, workItemId]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().replace(/^\//, '');
    if (!q) return commands;
    return commands.filter(
      (cmd) => cmd.name.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q)
    );
  }, [query, commands]);

  const clampedIndex = filtered.length > 0 ? Math.min(selectedIndex, filtered.length - 1) : 0;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // No matches → invisible menu must not swallow keys (the composer keeps
      // Enter-to-send). Consumed keys stopPropagation so the composer's own
      // handler stays out while the menu shows.
      if (!visible || filtered.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        onSelect(`/${filtered[clampedIndex].name}`);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [visible, filtered, clampedIndex, onSelect, onClose]
  );

  useEffect(() => {
    if (!visible) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, handleKeyDown]);

  useEffect(() => {
    // children[0] is the section header; rows start at 1.
    const el = listRef.current?.children[clampedIndex + 1] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [clampedIndex]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={cn(
        'floating-surface-solid absolute left-0 z-50 max-h-80 w-96 overflow-y-auto rounded-xl py-1.5',
        placement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
      )}
    >
      <div className="px-3 py-1.5 text-micro tracking-micro font-semibold uppercase text-text-passive">
        Commands & skills
      </div>
      {filtered.map((cmd, i) => {
        const Icon = cmd.type === 'skill' ? Sparkles : SquareSlash;
        return (
          <div
            key={`${cmd.scope}:${cmd.name}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(`/${cmd.name}`);
            }}
            onMouseEnter={() => setSelectedIndex(i)}
            className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-body tracking-body transition-colors duration-[80ms] ${
              i === clampedIndex
                ? 'bg-surface-inset/60 text-text'
                : 'text-text-muted hover:bg-surface-inset/60'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0 text-text-passive" />
            <span className="font-semibold">/{cmd.name}</span>
            <span className="flex-1 truncate text-tiny tracking-tiny text-text-passive">
              {cmd.description}
            </span>
          </div>
        );
      })}
    </div>
  );
}
