import { AtSign, ChevronDown, ChevronRight, GitBranch, TriangleAlert, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { cssVarRef } from '@renderer/utils/cssVars';
import { formatTime } from './chat-message-transform';
import { PullRequestCard } from './chat-pr-card';
import type { ChatMessageEntry, ContentBlock, SystemEventEntry } from './chat-types';
import { HistoryPlanCard } from './history-plan-card';
import { useMentionPillPlugins } from './mention-roster';
import { PlanProgress } from './plan-progress';
import { ReasoningBlock } from './reasoning-block';
import { ToolCallBadge } from './tool-call-badge';
import { ToolCallSequence } from './tool-call-sequence';
import { TurnArtifactChips, type OpenArtifactHandler } from './turn-artifact-chips';

function ToolCallBlock({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      className="mt-1 cursor-pointer rounded-[var(--radius-sm)] bg-transparent px-2 py-1.5 text-tiny tracking-tiny text-text-passive transition-colors duration-150 ease-out hover:bg-surface-raised hover:text-text-muted"
    >
      <div className="flex items-center gap-1">
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        {summary}
      </div>
    </div>
  );
}

/**
 * A message's prose. Mentions render as pills through the roster-scoped rehype
 * plugin, so `@agent`, `@everyone` and a teammate's name read as addressed
 * rather than as stray punctuation — and the pill covers exactly the text the
 * router matched.
 */
function MessageProse({
  text,
  isFirst,
  dense = false,
  typedByPerson = false,
}: {
  text: string;
  isFirst: boolean;
  /** The user's own bubble reads at the tier below the agent's prose: it is
      re-read far less often than the reply it prompted, so it gives the column
      back some width and height rather than competing with the answer. */
  dense?: boolean;
  /** A person's message: `<my answer>` in it is what they typed, not HTML. */
  typedByPerson?: boolean;
}) {
  const mentionPlugins = useMentionPillPlugins();
  const size = dense ? 'text-body' : 'text-content';
  return (
    <MarkdownRenderer
      content={text}
      variant="compact"
      htmlAsText={typedByPerson}
      extraRehypePlugins={mentionPlugins}
      className={`${size} tracking-body text-text${isFirst ? '' : ' mt-2'}`}
    />
  );
}

export function ContentBlockView({
  block,
  isFirst,
  workItemId,
  onOpenArtifact,
  dense = false,
  typedByPerson = false,
}: {
  block: ContentBlock;
  isFirst: boolean;
  workItemId?: string;
  onOpenArtifact?: OpenArtifactHandler;
  dense?: boolean;
  typedByPerson?: boolean;
}) {
  switch (block.type) {
    case 'text':
      return (
        <MessageProse
          text={block.text}
          isFirst={isFirst}
          dense={dense}
          typedByPerson={typedByPerson}
        />
      );
    case 'tool-call':
      return <ToolCallBlock summary={block.summary} />;
    case 'tool-call-rich':
      return (
        <div className="mt-1">
          <ToolCallBadge data={block.data} />
        </div>
      );
    case 'tool-sequence':
      return (
        <div className="mt-1">
          <ToolCallSequence calls={block.calls} />
        </div>
      );
    case 'reasoning':
      return (
        <ReasoningBlock text={block.text} status={block.status} durationSec={block.durationSec} />
      );
    case 'permission':
      return null;
    case 'plan':
      return (
        <PlanProgress
          entries={block.entries}
          completedCount={block.completedCount}
          totalCount={block.totalCount}
        />
      );
    case 'plan-approval':
      return (
        <HistoryPlanCard
          workItemId={workItemId}
          planItemId={block.planItemId}
          artifactId={block.artifactId}
          title={block.title}
          overview={block.overview}
          steps={block.steps}
          status={block.status}
          rationale={block.rationale}
          planMarkdown={block.planMarkdown}
          onOpenArtifact={onOpenArtifact}
        />
      );
    case 'error':
      return (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-status-err/30 bg-status-err/5 px-3 py-2 text-tiny tracking-tiny text-status-err">
          {block.message}
        </div>
      );
    case 'file-badges':
      return (
        <div className="mt-2 flex flex-wrap gap-1">
          {block.files.map((f) => (
            <span
              key={f.name}
              className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-surface-raised px-2 py-0.5 font-mono text-tiny tracking-tiny text-text-muted"
            >
              {f.name} <span className="text-status-ok">+{f.added}</span>{' '}
              <span className="text-status-err">-{f.removed}</span>
            </span>
          ))}
        </div>
      );
    case 'artifact':
      // A persisted artifact row is its own message, so it has no turn footer
      // to join — it renders as the same document chip the footer uses.
      return (
        <TurnArtifactChips
          artifacts={[{ artifactId: block.data.artifactId, title: block.data.title }]}
          workItemId={workItemId}
          workspaceRoot={null}
          onOpenArtifact={onOpenArtifact}
        />
      );
    case 'code-block':
      return (
        <MarkdownRenderer
          content={'```\n' + block.code + '\n```'}
          variant="compact"
          className="mt-2"
        />
      );
    case 'pr-card':
      return <PullRequestCard data={block.data} workItemId={workItemId} />;
  }
}

export function UserMessageRow({
  entry,
  workItemId,
  onOpenArtifact,
}: {
  entry: ChatMessageEntry;
  workItemId?: string;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  return (
    /* The bubble is `--surface-inset` with a 10/10/5/10 radius: the clipped
       corner points back at the sender, which is what distinguishes it from
       the agent's flush-left prose without needing a label. */
    <div className="group flex max-w-[85%] flex-col items-end gap-1 self-end">
      <div className="rounded-[10px_10px_5px_10px] bg-surface-inset px-3 py-2">
        {entry.blocks.map((block, i) => (
          <ContentBlockView
            key={i}
            block={block}
            isFirst={i === 0}
            workItemId={workItemId}
            onOpenArtifact={onOpenArtifact}
            dense
            typedByPerson
          />
        ))}
      </div>
      {/* Timestamp and identity are reference, not content — they surface on
          hover so a scrolled transcript is just the conversation. */}
      <div className="flex items-center gap-2 pr-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
        <span className="text-tiny tracking-tiny text-text-passive">{entry.time}</span>
        <div
          className="flex h-5 w-5 items-center justify-center rounded-full text-avatar-lg font-bold text-white"
          style={
            entry.avatarStyle
              ? { background: entry.avatarStyle.bg, color: entry.avatarStyle.fg }
              : { background: cssVarRef('--identity-peer-2-fg') }
          }
        >
          {entry.initials}
        </div>
      </div>
    </div>
  );
}

export function AgentMessageRow({
  entry,
  workItemId,
  onOpenArtifact,
}: {
  entry: ChatMessageEntry;
  workItemId?: string;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  return (
    /*
     * Flush left, no avatar and no byline.
     *
     * The agent is the narrator of this surface, not a participant in it —
     * every second row would carry the same face and the same name, which is
     * pure repetition, and the 30px indent it forced made the agent's prose
     * the only text in the column that didn't start at the margin. Teammates
     * keep their byline (see TeammateMessageRow): there the name is the
     * information, because it varies.
     */
    <div className="group flex max-w-full flex-col gap-1">
      <div className="flex flex-col gap-2">
        {entry.blocks.map((block, i) => (
          <ContentBlockView
            key={i}
            block={block}
            isFirst={i === 0}
            workItemId={workItemId}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
        <span className="text-tiny tracking-tiny text-text-passive">{entry.time}</span>
      </div>
    </div>
  );
}

export function TeammateMessageRow({
  entry,
  workItemId,
  onOpenArtifact,
}: {
  entry: ChatMessageEntry;
  workItemId?: string;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  return (
    /*
     * A teammate is a participant in the conversation, so their words sit in a
     * bubble like the reader's own — mirrored to the left, with the clipped
     * corner pointing back at them, and the avatar outside it so a glance down
     * the thread reads as an exchange between people. Only the agent stays
     * flush-left and unbubbled: it narrates, it does not converse.
     *
     * The name is reference, not content, and repeats on every consecutive
     * message — it surfaces on hover with the timestamp, the same rule the
     * reader's own rows follow. The avatar carries identity at rest.
     */
    <div className="group flex max-w-[85%] items-start gap-2 self-start">
      <div
        className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-tiny tracking-tiny font-medium text-white"
        style={
          entry.avatarStyle
            ? { background: entry.avatarStyle.bg, color: entry.avatarStyle.fg }
            : { background: cssVarRef('--identity-peer-2-fg') }
        }
      >
        {entry.initials}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="rounded-[10px_10px_10px_5px] bg-surface-inset px-3.5 py-2.5">
          {entry.blocks.map((block, i) => (
            <ContentBlockView
              key={i}
              block={block}
              isFirst={i === 0}
              workItemId={workItemId}
              onOpenArtifact={onOpenArtifact}
              typedByPerson
            />
          ))}
        </div>
        <div className="flex items-center gap-2 pl-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
          <span className="text-tiny tracking-tiny font-medium text-text-muted">{entry.name}</span>
          <span className="text-tiny tracking-tiny text-text-passive">{entry.time}</span>
        </div>
      </div>
    </div>
  );
}

export function MessageRow({
  entry,
  workItemId,
  currentUserId,
  onOpenArtifact,
}: {
  entry: ChatMessageEntry;
  workItemId?: string;
  /** Signed-in user's cloud id; decides own-bubble vs teammate rendering. */
  currentUserId?: string | null;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  if (entry.sender === 'human') {
    // "Mine" means authored by the signed-in user — not merely human. Rows
    // without a sender_id are legacy local writes, which only this device's
    // owner could have produced.
    const isSelf = entry.senderId === null || entry.senderId === currentUserId;
    if (isSelf) {
      return (
        <UserMessageRow entry={entry} workItemId={workItemId} onOpenArtifact={onOpenArtifact} />
      );
    }
    return (
      <TeammateMessageRow entry={entry} workItemId={workItemId} onOpenArtifact={onOpenArtifact} />
    );
  }
  return <AgentMessageRow entry={entry} workItemId={workItemId} onOpenArtifact={onOpenArtifact} />;
}

export function SystemEventRow({ entry }: { entry: SystemEventEntry }) {
  // An unreadable row is shown, not skipped: a gap in the transcript is worse
  // than a marker saying which message is missing.
  if (entry.degraded) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-status-err/30 bg-status-err/5 px-3 py-2 text-body tracking-body text-status-err"
      >
        <TriangleAlert className="h-[14px] w-[14px] shrink-0" />
        <span>{entry.message}</span>
      </div>
    );
  }

  // The head of a forked chat: where, and from which turn's time, it came.
  if (entry.event?.type === 'forked_from') {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-surface-raised px-3 py-2 text-body tracking-body text-text-muted">
        <GitBranch className="h-[14px] w-[14px] shrink-0 text-text-passive" />
        <span>
          {entry.message} at {formatTime(entry.event.forkedAt)}
        </span>
      </div>
    );
  }

  // A Reset: the rows above it, back to its target turn, render dimmed.
  if (entry.event?.type === 'history_reset') {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-surface-raised px-3 py-2 text-body tracking-body text-text-muted">
        <Undo2 className="h-[14px] w-[14px] shrink-0 text-text-passive" />
        <span>{entry.message}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-surface-raised px-3 py-2 text-body tracking-body text-text-muted">
      <AtSign className="h-[14px] w-[14px] shrink-0 text-text-passive" />
      <span>
        commit <span className="font-mono text-tiny tracking-tiny">{entry.commitHash}</span> &mdash;{' '}
        {entry.message}
      </span>
    </div>
  );
}
