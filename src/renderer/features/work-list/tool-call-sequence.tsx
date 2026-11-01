import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { ToolCallBlockData } from './chat-types';
import { ToolCallBadge, ToolKindIcon } from './tool-call-badge';
import { summarizeToolCalls } from './tool-call-summary';

/**
 * The activity rail: a hairline down the gutter with each call's icon sitting
 * on it, so a run of tool calls reads as one continuous thread rather than a
 * stack of unrelated rows. The last rail segment stops at its icon — the
 * thread ends where the work ended, instead of trailing into the next block.
 */
function RailedCall({ call, last }: { call: ToolCallBlockData; last: boolean }) {
  return (
    <div className="flex min-h-[38px]">
      <div className="relative w-[26px] shrink-0">
        <span
          aria-hidden
          className={`absolute left-[12.5px] top-0 w-px bg-border-strong ${last ? 'h-[19px]' : 'bottom-0'}`}
        />
        <span className="absolute left-[6px] top-[12px] flex">
          <ToolKindIcon kind={call.kind} />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <ToolCallBadge data={call} hideIcon />
      </div>
    </div>
  );
}

export function ToolCallSequence({ calls }: { calls: ToolCallBlockData[] }) {
  const [expanded, setExpanded] = useState(false);
  const runningCall = calls.find((c) => c.status === 'in_progress');

  if (calls.length === 1) {
    return <ToolCallBadge data={calls[0]} />;
  }

  return (
    <div>
      {/* A running call stays visible while the group is shut: collapsing the
          only indication that the agent is still working reads as a stall. */}
      {!expanded && runningCall && <ToolCallBadge data={runningCall} />}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-1 border-none bg-transparent px-0 py-0 text-left text-tiny tracking-tiny text-text-passive transition-colors duration-150 ease-out hover:text-text-muted"
        style={{ minHeight: 26 }}
      >
        <span className="flex w-[26px] shrink-0 justify-center">
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-150 ${expanded ? '' : '-rotate-90'}`}
          />
        </span>
        <span className="min-w-0 truncate">{summarizeToolCalls(calls)}</span>
      </button>
      {expanded && (
        <div className="pt-0.5">
          {calls.map((call, i) => (
            <div
              key={call.callId}
              className="animate-stagger-in"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <RailedCall call={call} last={i === calls.length - 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
