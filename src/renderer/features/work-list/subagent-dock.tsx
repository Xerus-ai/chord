import { Loader2, X } from 'lucide-react';
import React from 'react';
import type { SubagentItem } from '@shared/stream-items';

interface SubagentDockProps {
  agents: SubagentItem[];
  onStopAll?: () => void;
}

function SubagentDockComponent({ agents, onStopAll }: SubagentDockProps) {
  const running = agents.filter((a) => a.status === 'running');
  if (running.length === 0) return null;

  return (
    // Positioned by the caller's bottom-anchored stack, not by this component.
    <div className="border-t border-border-subtle bg-surface-raised px-5 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-body tracking-body font-semibold text-text">
          {running.length} Working
        </span>
        {onStopAll && (
          <button
            onClick={onStopAll}
            className="flex cursor-pointer items-center gap-1 rounded-xs border-none bg-transparent px-2 py-1 text-tiny tracking-tiny text-text-passive transition-colors duration-100 hover:bg-surface-inset hover:text-text-muted"
          >
            Stop All <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {running.map((agent) => (
        <div key={agent.agentId} className="flex items-center gap-2 py-1 text-body tracking-body">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-passive" />
          <span className="font-semibold text-text-muted">{agent.name}</span>
          <span className="min-w-0 truncate text-text-passive">{agent.description}</span>
        </div>
      ))}
    </div>
  );
}

export const SubagentDock = React.memo(SubagentDockComponent);
