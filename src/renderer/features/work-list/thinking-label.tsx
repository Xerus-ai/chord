import { ChevronDown, ChevronRight } from 'lucide-react';
import React, { useState } from 'react';

interface ThinkingLabelProps {
  text: string;
  status: 'loading' | 'ready';
  durationSec?: number;
}

function ThinkingLabelComponent({ text, status, durationSec }: ThinkingLabelProps) {
  const [expanded, setExpanded] = useState(false);

  if (status === 'loading') {
    return null;
  }

  const durationLabel =
    durationSec != null && durationSec > 0 ? `Thought for ${durationSec}s` : 'Thought';

  return (
    <div className="mt-1.5">
      <button
        onClick={() => text && setExpanded((v) => !v)}
        className={`flex items-center gap-1.5 border-none bg-transparent px-0 py-0.5 text-left ${
          text ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className="text-body tracking-body italic text-text-passive">{durationLabel}</span>
        {text &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-text-passive/50" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-text-passive/50" />
          ))}
      </button>
      {expanded && text && (
        <div className="mt-1 border-l-2 border-text-passive/20 pl-3 py-2">
          <p className="whitespace-pre-wrap text-body tracking-body leading-relaxed text-text-passive">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

export const ThinkingLabel = React.memo(ThinkingLabelComponent);
