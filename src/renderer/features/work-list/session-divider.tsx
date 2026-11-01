import { Bot } from 'lucide-react';
import { formatTime } from './chat-message-transform';

/**
 * Marks where a transcript that mixes agent sessions crosses from one into
 * the next. Only a teammate's item chat has such rows (buildCloudTranscript);
 * a chat tab is one session and reads exactly like the owner's.
 */
export function SessionDivider({ ordinal, startedAt }: { ordinal: number; startedAt: number }) {
  return (
    <div
      role="separator"
      aria-label={`Start of session ${ordinal}`}
      className="flex items-center gap-3 py-1"
    >
      <span className="h-px flex-1 bg-border-subtle" />
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xs border border-border bg-surface-inset px-2 py-0.5 text-micro tracking-micro font-semibold text-text-muted">
        <Bot className="h-[11px] w-[11px]" />
        Session {ordinal}
        <span className="font-normal text-text-passive tabular-nums">{formatTime(startedAt)}</span>
      </span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}
