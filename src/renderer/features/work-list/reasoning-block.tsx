import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface ReasoningBlockProps {
  text: string;
  status: 'loading' | 'ready';
  durationSec?: number;
}

export function ReasoningBlock({ text, status, durationSec }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (status === 'loading') {
    return null;
  }

  const durationLabel =
    durationSec != null && durationSec > 0 ? `Thought for ${durationSec}s` : 'Thought';

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent px-0 py-0.5 text-left"
      >
        <span className="text-body tracking-body italic text-text-passive">{durationLabel}</span>
        <ChevronRight
          className={`h-3 w-3 shrink-0 text-text-passive/50 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div className="mt-1 border-l-2 border-text-passive/20 pl-3 py-2">
          <p className="whitespace-pre-wrap text-body tracking-body leading-relaxed text-text-passive">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
