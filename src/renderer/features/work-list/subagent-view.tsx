import { Bot, Check, Loader2, X } from 'lucide-react';
import React from 'react';
import type { SubagentItem } from '@shared/stream-items';
import { useStopAgent } from './use-stop-agent';

function StatusBadge({ status }: { status: SubagentItem['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-muted" />;
    case 'completed':
      return <Check className="h-3.5 w-3.5 shrink-0 text-status-ok" />;
    case 'failed':
      return <X className="h-3.5 w-3.5 shrink-0 text-status-err" />;
  }
}

interface SubagentViewProps {
  agents: SubagentItem[];
  workItemId: string;
}

function SubagentViewComponent({ agents, workItemId }: SubagentViewProps) {
  const running = agents.filter((a) => a.status === 'running').length;
  const { stopping, stopAll } = useStopAgent(workItemId);

  return (
    <div className="tool-group mt-2 overflow-hidden rounded-[var(--radius-sm)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <Bot className="h-3.5 w-3.5 shrink-0 text-text-passive" />
        <span className="text-tiny tracking-tiny font-medium text-text-muted">
          {running > 0 ? `${running} Working` : `${agents.length} Completed`}
        </span>
        {running > 0 && (
          <button
            onClick={stopAll}
            disabled={stopping}
            title="Stop the agent session running these subagents"
            className="ml-auto cursor-pointer rounded-[var(--radius-sm)] border-none bg-transparent px-2 py-0.5 text-tiny tracking-tiny text-text-passive transition-colors duration-100 hover:bg-surface-inset hover:text-text-muted disabled:cursor-default disabled:text-text-passive disabled:hover:bg-transparent"
          >
            {stopping ? 'Stopping…' : 'Stop All'}
          </button>
        )}
      </div>
      <div className="tool-group-body">
        {agents.map((agent) => (
          <div
            key={agent.agentId}
            className="flex items-center gap-2 px-3 py-2 text-tiny tracking-tiny"
          >
            <StatusBadge status={agent.status} />
            <span className="font-medium text-text-muted">{agent.name}</span>
            {agent.model && (
              <span className="rounded-xs bg-surface-inset px-1.5 py-[1px] font-mono text-micro tracking-micro text-text-passive">
                {agent.model}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-text-passive">{agent.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const SubagentView = React.memo(SubagentViewComponent);
