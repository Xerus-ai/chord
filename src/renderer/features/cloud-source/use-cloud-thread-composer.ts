import { useCallback, useMemo, useState } from 'react';
import type { ResolvedRoute } from '@renderer/features/work-list/chat-routing';
import {
  AGENT_ACCESS_REASON,
  resolveComposerAccess,
} from '@renderer/features/work-list/composer-access';
import { useTypingSender } from '@renderer/features/work-list/use-typing-indicators';
import type { WorkItemCapabilities } from '@renderer/features/work-list/work-item-access';
import { cloudApi, type CloudWorkItem } from '@renderer/lib/cloud-api';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { useCloudChatContext } from './cloud-chat-context';

/**
 * Copy for a rejected send-to-agent. The composer already blocks the two
 * known 403 sources up front (viewer role, owner-only policy), so a 403 that
 * still lands means the policy flipped between render and POST — name that
 * case; anything else shows the server's own message.
 */
function describeAgentSendFailure(error: unknown): string {
  if (error instanceof CloudApiError && error.status === 403) return AGENT_ACCESS_REASON;
  return (error as Error).message;
}

/**
 * A teammate's composer for one chat tab: where a send goes and why it can't.
 * `sessionId` is the tab's chat; null only for the item chat, where the
 * server stores the message as work-item history. An ended chat takes none.
 */
export function useCloudThreadComposer(
  item: CloudWorkItem,
  sessionId: string | null,
  capabilities: WorkItemCapabilities,
  { ended }: { ended: boolean }
) {
  const workItemId = item.id;
  const { feed, roomStatus, recordCommand } = useCloudChatContext();
  const { sendMessage, sendPromptToAgent } = feed;
  const sendTyping = useTypingSender(workItemId);
  const [sendError, setSendError] = useState<string | null>(null);
  const deviceOnline = item.creator_device_online ?? false;

  const access = useMemo(
    () => resolveComposerAccess({ capabilities, connection: roomStatus, deviceOnline, ended }),
    [capabilities, roomStatus, deviceOnline, ended]
  );

  // Points at the sent message, so a click can open it.
  const notifyMentions = useCallback(
    (content: string, userIds: string[], messageId: string) => {
      if (userIds.length === 0) return;
      cloudApi
        .notifyMentions(workItemId, userIds, content.slice(0, 200), { message_id: messageId })
        .catch((error: unknown) => {
          console.error('[cloud-chat-thread] mention notification failed:', error);
        });
    },
    [workItemId]
  );

  // One Enter, two destinations. Agent-bound drafts become a `prompt` command
  // — room-visible chat immediately, delivered into the owner's agent session
  // by the command channel; thread-bound drafts are plain chat the agent picks
  // up through the thread digest on its next turn. Either failure keeps the
  // draft; a rejected prompt also names the reason under the composer.
  const onSend = useCallback(
    (content: string, route: ResolvedRoute): boolean | Promise<boolean> => {
      if (route.audience === 'agent') {
        setSendError(null);
        return sendPromptToAgent(content, sessionId)
          .then(({ command, chatMessageId }) => {
            recordCommand(command);
            notifyMentions(content, route.mentionedUserIds, chatMessageId);
            return true;
          })
          .catch((error: unknown) => {
            setSendError(describeAgentSendFailure(error));
            return false;
          });
      }
      const sentId = sendMessage(content, sessionId);
      // A closed socket keeps the draft — never silent loss.
      if (!sentId) return false;
      notifyMentions(content, route.mentionedUserIds, sentId);
      return true;
    },
    [sessionId, sendMessage, sendPromptToAgent, recordCommand, notifyMentions]
  );

  const onDraftChange = useCallback(
    (draft: string) => {
      setSendError(null);
      sendTyping(draft.length > 0);
    },
    [sendTyping]
  );

  return {
    access,
    // An untagged message reaches the agent only where the owner delegated
    // it; otherwise it lands in the thread without spending the owner's turn.
    untaggedAudience: capabilities.promptAgent ? ('agent' as const) : ('thread' as const),
    onSend,
    onDraftChange,
    onBlur: () => sendTyping(false),
    errorNotice: sendError,
    connected: roomStatus === 'joined',
  };
}
