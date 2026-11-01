import { announceSessionsChanged } from '@main/core/agent-sessions/announce-sessions-changed';
import { scheduleSessionCloudSync } from '@main/core/agent-sessions/session-cloud-sync';
import { titleUntitledChat } from '@main/core/agent-sessions/title-untitled-chat';
import { attributeMessageToSession } from './attribute-message-to-session';

/**
 * What a saved message reaching a chat session changes: the message is that
 * session's (devstation-w50w), and a titleless chat takes it as its title
 * (devstation-d8lx) — a command is not a name, so a slash command titles
 * nothing. A new title is published like a rename.
 */
export async function noteMessageDelivered(args: {
  workItemId: string;
  messageId: string;
  sessionId: string;
  content: string;
  isSlashCommand: boolean;
}): Promise<void> {
  await attributeMessageToSession(args.messageId, args.sessionId);
  if (args.isSlashCommand) return;
  if (await titleUntitledChat(args.sessionId, args.content)) {
    scheduleSessionCloudSync(args.workItemId);
    announceSessionsChanged(args.workItemId);
  }
}
