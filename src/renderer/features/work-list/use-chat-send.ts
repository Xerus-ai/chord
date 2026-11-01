import { useCallback, useState } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import type { ResolvedRoute } from './chat-routing';

/**
 * The send half of a composer, shared by every thread: delivery into one
 * session, mention notifications, and the error and in-flight latch the
 * composer shows. A message addressed only to people goes to the same thread
 * without waking the agent (`postToThread`); the agent reads it in the thread
 * digest on its next turn.
 *
 * `sending` covers the gap between an agent send and its first turn event;
 * the caller releases it with `releaseSending` once its turn stream moves.
 */
export function useChatSend(workItemId: string) {
  const { data: account } = useAccountSession();
  const senderName = account?.user?.username || account?.user?.email || 'Me';
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  /**
   * Resolves the id of the saved message once delivery settles, or null when
   * it was not saved. A message can be saved and still not reach the agent
   * (`agent_start_failed`, `worktree_archived`): the error says so, and the
   * id is still returned, since the message exists.
   * `agentProviderId` is the agent the composer shows; an untargeted send
   * starts that agent rather than whatever the work item last ran.
   */
  const sendToAgent = useCallback(
    (
      content: string,
      sessionId: string | null,
      agentProviderId?: string
    ): Promise<string | null> => {
      setSendError(null);
      setSending(true);
      return rpc.chatMessages
        .sendToAgent({
          workItemId,
          content,
          senderName,
          sessionId: sessionId ?? undefined,
          agentProviderId,
        })
        .then((result) => {
          if (result.success) return result.data.messageId;
          setSending(false);
          setSendError(
            result.error.type === 'not_found'
              ? 'This work item no longer exists, so the message was not delivered.'
              : result.error.type === 'workspace_not_ready'
                ? 'The workspace is still being set up — try again in a moment.'
                : result.error.type === 'no_agent_provider'
                  ? 'No agent is selected for this work item — pick one in the composer and send again.'
                  : result.error.type === 'agent_start_failed'
                    ? `The agent could not be started: ${result.error.message}. Your message was saved — send it again once the problem is fixed.`
                    : result.error.message
          );
          return 'messageId' in result.error ? result.error.messageId : null;
        })
        .catch((e: unknown) => {
          setSending(false);
          setSendError(e instanceof Error ? e.message : String(e));
          return null;
        });
    },
    [workItemId, senderName]
  );

  /** Resolves the saved message's id, or null when it was not saved (the error says why). */
  const postToThread = useCallback(
    (content: string, sessionId: string): Promise<string | null> => {
      setSendError(null);
      return rpc.chatMessages
        .postToThread({ workItemId, sessionId, content, senderName })
        .then((result) => {
          if (result.success) return result.data.messageId;
          setSendError(result.error.message);
          return null;
        })
        .catch((e: unknown) => {
          setSendError(e instanceof Error ? e.message : String(e));
          return null;
        });
    },
    [workItemId, senderName]
  );

  // Notifications follow the resolved mentions, not a scan for '@', and point
  // at the saved message so a click can open it.
  const notifyMentions = useCallback(
    (content: string, route: ResolvedRoute, messageId: string) => {
      if (route.mentionedUserIds.length === 0) return;
      cloudApi
        .notifyMentions(workItemId, route.mentionedUserIds, content.slice(0, 200), {
          message_id: messageId,
        })
        .catch((e: unknown) => console.error('[chat] mention notification failed:', e));
    },
    [workItemId]
  );

  const releaseSending = useCallback(() => setSending(false), []);
  const dismissError = useCallback(() => setSendError(null), []);

  return {
    sending,
    sendError,
    sendToAgent,
    postToThread,
    notifyMentions,
    releaseSending,
    dismissError,
  };
}
