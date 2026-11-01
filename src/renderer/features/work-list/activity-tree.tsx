import {
  Bot,
  ChevronDown,
  ClipboardList,
  Code2,
  Eye,
  Globe,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import React, { useState } from 'react';
import type { ToolCallItem } from '@shared/stream-items';

const KIND_PILL_STYLES: Record<string, string> = {
  read: 'bg-surface-hover text-text-passive',
  edit: 'bg-surface-hover text-text-passive',
  execute: 'bg-surface-hover text-text-passive',
  search: 'bg-surface-hover text-text-passive',
  fetch: 'bg-surface-hover text-text-passive',
  agent: 'bg-surface-hover text-text-passive',
  task: 'bg-surface-hover text-text-passive',
};

const DEFAULT_PILL_STYLE = 'bg-surface-hover-solid text-text-passive';

function ToolKindIcon({ kind, className }: { kind: string; className?: string }) {
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

function DoneIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className="text-text-passive"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ActiveDot() {
  return <span className="tool-call-shimmer h-2.5 w-2.5 rounded-full" />;
}

function PendingCircle() {
  return (
    <span className="m-[1px] h-[14px] w-[14px] rounded-full border-[1.5px] border-text-passive/40" />
  );
}

function FailedX() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className="text-status-err"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <DoneIcon />;
    case 'in_progress':
      return <ActiveDot />;
    case 'failed':
      return <FailedX />;
    default:
      return <PendingCircle />;
  }
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

function extractDetailPill(tool: ToolCallItem): string | null {
  if (tool.locations && tool.locations.length > 0) {
    const loc = tool.locations[0];
    const filename = basename(loc.filePath);
    if (loc.startLine != null) {
      const range =
        loc.endLine != null && loc.endLine !== loc.startLine
          ? `${loc.startLine}-${loc.endLine}`
          : `${loc.startLine}`;
      return `${filename}:${range}`;
    }
    return filename;
  }

  const input = tool.rawInput;
  if (!input) return null;

  const filePath = (input.file_path ?? input.path) as string | undefined;
  if (filePath) return basename(filePath);

  const command = input.command as string | undefined;
  if (command) {
    const trimmed = command.trim();
    return trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed;
  }

  const pattern = (input.pattern ?? input.query ?? input.q) as string | undefined;
  if (pattern) {
    const display = pattern.length > 40 ? pattern.slice(0, 37) + '...' : pattern;
    return `"${display}"`;
  }

  const status = input.status as string | undefined;
  if (status) {
    const taskId = (input.task_id ?? input.id) as string | undefined;
    const label = taskId ? `${taskId.slice(0, 8)}… → ${status}` : status;
    return label;
  }

  const description = (input.description ?? input.prompt ?? input.name ?? input.task) as
    | string
    | undefined;
  if (description) {
    const trimmed = description.trim();
    return trimmed.length > 50 ? trimmed.slice(0, 47) + '...' : trimmed;
  }

  return null;
}

function BashExpandedContent({ tool }: { tool: ToolCallItem }) {
  const blocks = tool.contentBlocks;
  if (!blocks || blocks.length === 0) return null;

  const commandBlock = blocks.find((b) => b.type === 'text' && b.text?.includes('\n'));
  const outputBlock = blocks.find((b) => b !== commandBlock);
  const commandText = commandBlock?.text ?? blocks[0]?.text ?? blocks[0]?.diff ?? '';
  const outputText = outputBlock?.text ?? outputBlock?.diff;

  return (
    <div className="animate-expand-in mt-2 ml-[24px] mb-1">
      <div className="overflow-hidden rounded-[var(--radius-sm)] border border-border/40">
        <div className="border-b border-border/30 bg-surface-raised px-3 py-2">
          <span className="text-micro tracking-micro font-medium uppercase text-text-passive">
            bash
          </span>
        </div>
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap bg-surface px-3 py-2 font-mono text-tiny tracking-tiny leading-[1.6] text-text-muted">
          {commandText}
        </pre>
        {outputText && (
          <>
            <div className="border-t border-border/30 bg-surface-raised px-3 py-2">
              <span className="text-micro tracking-micro font-medium uppercase text-text-passive">
                Output
              </span>
            </div>
            <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap bg-surface px-3 py-2 font-mono text-tiny tracking-tiny leading-[1.6] text-text-passive">
              {outputText}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

function GenericExpandedContent({ tool }: { tool: ToolCallItem }) {
  const blocks = tool.contentBlocks;
  if (!blocks || blocks.length === 0) return null;

  const nonEmpty = blocks.filter((b) => (b.diff ?? b.text ?? '').trim().length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="animate-expand-in mt-2 ml-[24px] mb-1">
      {nonEmpty.map((block, i) => (
        <pre
          key={i}
          className="tool-content-block max-h-[250px] overflow-auto whitespace-pre-wrap font-mono text-tiny tracking-tiny leading-[1.6] text-text-passive"
        >
          {block.diff ?? block.text ?? ''}
        </pre>
      ))}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolCallItem }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = tool.status === 'in_progress';
  const hasContent =
    tool.contentBlocks &&
    tool.contentBlocks.some((b) => (b.diff ?? b.text ?? '').trim().length > 0);
  const isBash = tool.kind === 'execute';
  const pillStyle = KIND_PILL_STYLES[tool.kind] ?? DEFAULT_PILL_STYLE;
  const detailPill = extractDetailPill(tool);
  const extraLocations = tool.locations ? tool.locations.slice(1) : [];

  return (
    <div>
      <button
        onClick={() => hasContent && setExpanded((v) => !v)}
        className={`flex w-full items-center gap-2 border-none bg-transparent py-1 pl-0 pr-1 text-left transition-colors duration-75 ${
          hasContent ? 'cursor-pointer hover:bg-surface-inset/30' : 'cursor-default'
        }`}
        style={{ borderRadius: 'var(--radius-sm)' }}
      >
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <StatusIcon status={tool.status} />
        </div>

        <ToolKindIcon
          kind={tool.kind}
          className={`h-[14px] w-[14px] shrink-0 ${
            pillStyle
              .split(' ')
              .filter((c) => c.startsWith('text-'))
              .join(' ') || 'text-text-passive'
          }`}
        />

        <span
          className={`text-body tracking-body leading-[1.4] ${
            isActive ? 'text-text' : 'text-text-muted'
          }`}
        >
          {tool.name}
        </span>

        {detailPill && (
          <span
            className={`shrink-0 rounded-xs px-2 py-0.5 font-mono text-tiny tracking-tiny leading-[1.3] ${pillStyle}`}
          >
            {detailPill}
          </span>
        )}

        {extraLocations.map((loc, i) => {
          const parts = loc.filePath.split(/[/\\]/);
          const name = parts[parts.length - 1] ?? loc.filePath;
          return (
            <span
              key={i}
              className={`shrink-0 rounded-xs px-2 py-0.5 font-mono text-tiny tracking-tiny leading-[1.3] ${pillStyle}`}
            >
              {name}
            </span>
          );
        })}

        <span className="flex-1" />

        {hasContent &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-text-passive/60" />
          ) : (
            <Code2 className="h-3 w-3 shrink-0 text-text-passive/40" />
          ))}
      </button>

      {expanded &&
        hasContent &&
        (isBash ? <BashExpandedContent tool={tool} /> : <GenericExpandedContent tool={tool} />)}
    </div>
  );
}

interface ActivityTreeProps {
  tools: ToolCallItem[];
}

function ActivityTreeComponent({ tools }: ActivityTreeProps) {
  return (
    <div className="relative flex flex-col gap-px pb-2 pl-3 pr-2 pt-1">
      <div className="absolute bottom-3 left-[20px] top-2 w-px bg-border/30" />
      {tools.map((tool) => (
        <ToolRow key={tool.callId} tool={tool} />
      ))}
    </div>
  );
}

export const ActivityTree = React.memo(ActivityTreeComponent);
