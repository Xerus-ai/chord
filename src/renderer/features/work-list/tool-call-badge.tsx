import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Globe,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { ToolCallBlockData, ToolCallKind, ToolCallStatus } from './chat-types';

const iconClass = 'h-[14px] w-[14px] shrink-0 text-text-passive';

export function ToolKindIcon({ kind }: { kind: ToolCallKind | 'thinking' }) {
  switch (kind) {
    case 'read':
      return <Eye className={iconClass} />;
    case 'edit':
      return <Pencil className={iconClass} />;
    case 'execute':
      return <SquareTerminal className={iconClass} />;
    case 'search':
      return <Search className={iconClass} />;
    case 'fetch':
      return <Globe className={iconClass} />;
    case 'thinking':
      return <Brain className={iconClass} />;
    default:
      return <Wrench className={iconClass} />;
  }
}

function StatusIndicator({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case 'completed':
      return <Check className="h-3 w-3 shrink-0 text-status-ok" />;
    case 'failed':
      return <X className="h-3 w-3 shrink-0 text-status-err" />;
    case 'pending':
      return <div className="h-3 w-3 shrink-0 rounded-full border border-text-passive" />;
    case 'in_progress':
      return <div className="tool-call-shimmer h-3 w-3 shrink-0 rounded-full" />;
  }
}

export function ToolCallBadge({
  data,
  /** The activity rail draws the kind icon in its gutter, so the badge drops
      its own copy rather than showing the same glyph twice on one row. */
  hideIcon = false,
}: {
  data: ToolCallBlockData;
  hideIcon?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = data.status === 'in_progress';

  return (
    <div className="overflow-hidden first:rounded-t-[var(--radius-sm)] last:rounded-b-[var(--radius-sm)]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-none bg-transparent px-2 py-1.5 text-left text-tiny tracking-tiny transition-colors duration-150 ease-out ${
          isRunning ? 'tool-call-badge-running' : 'hover:bg-surface-raised'
        }`}
        style={{ minHeight: 30 }}
      >
        {!hideIcon && <ToolKindIcon kind={data.kind} />}
        <span className="font-medium text-text-muted">{data.name}</span>
        {data.summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-tiny tracking-tiny text-text-passive">
            {data.summary}
          </span>
        )}
        <StatusIndicator status={data.status} />
        {data.content &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-text-passive" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-text-passive" />
          ))}
      </button>
      {expanded && data.content && (
        <div className="animate-expand-in border-t border-border bg-surface px-3 py-2">
          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap font-mono text-tiny tracking-tiny text-text-muted">
            {data.content}
          </pre>
        </div>
      )}
    </div>
  );
}
