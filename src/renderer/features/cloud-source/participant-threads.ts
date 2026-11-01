/**
 * Splits the work item's chat rows across its chat tabs.
 *
 * Pure on purpose: this rule decides what a teammate sees in each tab, and it
 * is easy to get quietly wrong.
 */
import type { CloudChatMessage } from '@chord/protocol';

/**
 * The rows that belong in one thread: its own, plus every row that belongs to
 * no thread at all. `sessionId` null is the item's chat, shown while the owner
 * has started no chat: every row.
 *
 * Null-session rows are old Room messages and participant sends the server
 * stamped null before the registry existed. They render in EVERY thread as
 * work-item history rather than being adopted into one, because session tabs
 * come and go and adopting them would eventually strand them in a container
 * the reader cannot open (the rule set out in the Room-removal plan).
 *
 * Input order is preserved rather than re-sorted: cloud-chat-store already
 * owns ordering, and a second sort here would be a second source of truth.
 */
export function selectThreadMessages(
  messages: CloudChatMessage[],
  sessionId: string | null
): CloudChatMessage[] {
  if (sessionId === null) return messages;
  return messages.filter((m) => m.session_id === null || m.session_id === sessionId);
}
