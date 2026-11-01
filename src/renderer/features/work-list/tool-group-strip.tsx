import {
  Bot,
  ChevronDown,
  ClipboardList,
  Eye,
  Globe,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import type { ToolCallItem } from '@shared/stream-items';
import { ActivityTree } from './activity-tree';

function ToolIcon({ kind, className }: { kind: string; className?: string }) {
  const cls = className ?? 'h-[14px] w-[14px] shrink-0';
  switch (kind) {
    case 'read':
      return <Eye className={cls} />;
    case 'edit':
      return <Pencil className={cls} />;
    case 'execute':
      return <SquareTerminal className={cls} />;
    case 'search':
      return <Search className={cls} />;
    case 'fetch':
      return <Globe className={cls} />;
    case 'agent':
      return <Bot className={cls} />;
    case 'task':
      return <ClipboardList className={cls} />;
    default:
      return <Wrench className={cls} />;
  }
}

interface ToolGroupStripProps {
  tools: ToolCallItem[];
}

function ToolGroupStripComponent({ tools }: ToolGroupStripProps) {
  const [expanded, setExpanded] = useState(false);
  const hasRunning = tools.some((t) => t.status === 'in_progress');
  const failedCount = tools.filter((t) => t.status === 'failed').length;
  const completedCount = tools.filter((t) => t.status === 'completed').length;

  const countText = `${tools.length} action${tools.length !== 1 ? 's' : ''}`;

  // The run's leading glyph is whichever kind it did most of, so a read-heavy
  // run and an edit-heavy run are tellable apart without expanding either.
  const dominantKind = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of tools) counts.set(tool.kind, (counts.get(tool.kind) ?? 0) + 1);
    let best = tools[0]?.kind ?? 'other';
    let bestCount = 0;
    for (const [kind, count] of counts) {
      if (count > bestCount) {
        best = kind;
        bestCount = count;
      }
    }
    return best;
  }, [tools]);

  const statusLabel = hasRunning
    ? null
    : failedCount > 0
      ? `${countText} · ${failedCount} failed`
      : completedCount === tools.length
        ? `${countText} ✓`
        : countText;

  const statusNode = hasRunning ? (
    <span className="flex items-center gap-1.5 text-text-muted">
      Working
      <span className="breathing-dots inline-flex items-center gap-0.5">
        <span />
        <span />
        <span />
      </span>
    </span>
  ) : (
    <span>{statusLabel}</span>
  );

  // One quiet disclosure row in both states: a leading kind icon, the run's
  // summary, and the chevron at the row's end. The collapsed state used to be a
  // grid of up to eight bordered icon chips, which made a routine tool run the
  // loudest thing in the turn — the run is context for the answer, not the
  // answer. Expanding only adds the tree beneath; the row itself does not move.
  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border-none bg-transparent px-1 py-1 text-left text-tiny tracking-tiny text-text-muted transition-colors duration-100 hover:text-text"
      >
        <ToolIcon kind={dominantKind} className="size-icon-sm shrink-0" />
        <span className={`tabular-nums ${failedCount > 0 ? 'text-status-err' : 'text-text-muted'}`}>
          {statusNode}
        </span>
        <span className="flex-1" />
        <ChevronDown
          className={`size-icon-xs shrink-0 transition-transform duration-100 ${expanded ? '' : '-rotate-90'}`}
        />
      </button>
      {/* Hidden, not unmounted: collapsing a run and reopening it should return
          the same tree, not a freshly-built one that has forgotten which rows
          the reader had already opened. */}
      <div hidden={!expanded}>
        <ActivityTree tools={tools} />
      </div>
    </div>
  );
}

export const ToolGroupStrip = React.memo(ToolGroupStripComponent);
