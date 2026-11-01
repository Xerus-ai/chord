import type { ReactNode } from 'react';
import { TypingIndicatorBar } from './typing-indicator-bar';

/**
 * One chat thread, owner's and teammate's alike: the transcript, then what the
 * agent is waiting on (cards, running subagents, errors), who else is typing,
 * then the composer.
 * Each source's container fills the slots (`LocalChatThread`,
 * `CloudChatThread`); the dock is in flow, so nothing it holds covers the
 * transcript's last rows. It is capped at a quarter of the thread and scrolls:
 * a teammate's dock lists every pending request of the chat, and the
 * conversation stays the larger part of the thread however many wait (one card
 * shows whole, the rest a scroll away; menus portal out, so the scroll clips
 * none).
 */
export function ChatThreadView({
  workItemId,
  transcript,
  dock,
  composer,
}: {
  workItemId: string;
  transcript: ReactNode;
  dock: ReactNode;
  composer: ReactNode;
}) {
  return (
    <div
      data-testid="chat-thread"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {transcript}
      <div data-testid="chat-dock" className="flex max-h-[25%] shrink-0 flex-col overflow-y-auto">
        {dock}
      </div>
      <TypingIndicatorBar workItemId={workItemId} />
      {composer}
    </div>
  );
}
