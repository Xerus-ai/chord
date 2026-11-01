import type { CloudChatMessage, CloudCommand } from '@chord/protocol';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { v7 as uuidv7 } from 'uuid';
import { cloudApi } from '@renderer/lib/cloud-api';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import type { RoomJoinStatus } from '@renderer/lib/sync/room-registry';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { applyBatch, type CloudChatState } from './cloud-chat-store';

// The two `error` frames the server sends for a rejected chat_message
// (server/src/ws/event-handlers.ts). Neither is retryable: the write was
// refused (read-only access) or the id collided with a row this user does
// not own. Anything else on the shared `error` channel belongs to another
// event type and must not touch this feed's pending sends.
const CHAT_REJECTION_ERRORS = ['Access denied: chat_message', 'chat_message: id conflict'];

/**
 * The sending half of the cloud chat feed (use-cloud-chat.ts): client-generated
 * UUIDv7 ids with optimistic append; the server ack carries the canonical
 * created_at, a rejection marks the send failed, and un-acked sends are
 * re-sent when the room is re-joined (idempotent by id).
 */
export function useCloudChatSend({
  workItemId,
  roomStatus,
  setState,
  mergeRows,
  unconfirmedIdsRef,
}: {
  workItemId: string;
  roomStatus: RoomJoinStatus | null;
  setState: Dispatch<SetStateAction<CloudChatState | null>>;
  mergeRows: (incoming: CloudChatMessage[]) => void;
  unconfirmedIdsRef: MutableRefObject<Set<string>>;
}) {
  const { subscribeEvent, sendEvent } = useSyncSocketContext();
  const { data: session } = useAccountSession();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const pendingSendsRef = useRef(
    new Map<string, { work_item_id: string; session_id: string | null; content: string }>()
  );

  useEffect(() => {
    const unsubscribeAck = subscribeEvent(
      'chat_message_ack',
      (payload) => {
        pendingSendsRef.current.delete(payload.id);
        // The ack replaces the optimistic created_at with the server's below,
        // so this row is safe to derive a reconnect cursor from again.
        unconfirmedIdsRef.current.delete(payload.id);
        setPendingIds((prev) => {
          if (!prev.has(payload.id)) return prev;
          const next = new Set(prev);
          next.delete(payload.id);
          return next;
        });
        // An ack for a row the error handler below marked failed means that
        // send did land after all (it was collateral of another send's
        // rejection) — clear the flag rather than leaving a false failure.
        setFailedIds((prev) => {
          if (!prev.has(payload.id)) return prev;
          const next = new Set(prev);
          next.delete(payload.id);
          return next;
        });
        // The ack carries the canonical created_at for the optimistic row —
        // reposition it through the same upsert path as everything else.
        setState((prev) => {
          if (!prev || prev.workItemId !== workItemId) return prev;
          const row = prev.byId.get(payload.id);
          if (!row || row.created_at === payload.created_at) return prev;
          return applyBatch(prev, workItemId, [{ ...row, created_at: payload.created_at }]);
        });
      },
      workItemId
    );

    // A rejected chat_message. The frame is a bare string with no id (see
    // CHAT_REJECTION_ERRORS), but every send this hook still holds un-acked
    // went through the same write gate on the same socket, so they are all
    // refused. Marking them failed and DROPPING them from pendingSendsRef is
    // what stops the rejoin effect below from replaying them on every
    // reconnect forever — a read-only viewer's message used to sit at
    // pending opacity and re-send for the life of the window. A send that
    // did get through is un-marked by its own ack (above).
    const unsubscribeError = subscribeEvent('error', (payload) => {
      if (typeof payload !== 'string') return;
      if (!CHAT_REJECTION_ERRORS.some((reason) => payload.startsWith(reason))) return;
      const rejected: string[] = [];
      for (const [id, pending] of pendingSendsRef.current) {
        if (pending.work_item_id !== workItemId) continue;
        rejected.push(id);
      }
      if (rejected.length === 0) return;
      for (const id of rejected) pendingSendsRef.current.delete(id);
      setPendingIds((prev) => {
        const next = new Set(prev);
        for (const id of rejected) next.delete(id);
        return next;
      });
      setFailedIds((prev) => {
        const next = new Set(prev);
        for (const id of rejected) next.add(id);
        return next;
      });
      console.error('[cloud-chat] send rejected by server:', payload);
    });

    return () => {
      unsubscribeAck();
      unsubscribeError();
    };
  }, [workItemId, subscribeEvent, setState, unconfirmedIdsRef]);

  const sendMessage = useCallback(
    (content: string, sessionId: string | null): string | null => {
      const user = session?.user;
      if (!user) return null;
      const id = uuidv7();
      const sent = sendEvent({
        type: 'chat_message',
        payload: {
          id,
          work_item_id: workItemId,
          session_id: sessionId,
          content,
          message_type: 'text',
        },
      });
      if (!sent) return null;

      pendingSendsRef.current.set(id, { work_item_id: workItemId, session_id: sessionId, content });
      unconfirmedIdsRef.current.add(id);
      setPendingIds((prev) => new Set(prev).add(id));
      mergeRows([
        {
          id,
          work_item_id: workItemId,
          // The optimistic row must carry the same thread the send named, or
          // it would flash into the history bucket of every thread and then
          // jump when the ack arrives.
          session_id: sessionId,
          sender_id: user.userId,
          sender_type: 'human',
          sender_name: user.email,
          content,
          message_type: 'text',
          metadata: {},
          // Reconciled by the ack; display order is server created_at.
          created_at: new Date().toISOString(),
        },
      ]);
      return id;
    },
    [workItemId, sendEvent, mergeRows, session, unconfirmedIdsRef]
  );

  const sendPromptToAgent = useCallback(
    async (
      content: string,
      sessionId: string | null
    ): Promise<{ command: CloudCommand; chatMessageId: string }> => {
      const user = session?.user;
      if (!user) throw new Error('Not signed in — sign in to send to the agent.');
      const chatMessageId = uuidv7();
      const command = await cloudApi.postCommand(workItemId, {
        kind: 'prompt',
        payload: { content, chat_message_id: chatMessageId },
        // Names the thread so the owner's inbox delivers to the agent the
        // teammate was actually addressing (selectCommandTargetSession).
        session_id: sessionId,
      });
      // The room broadcast usually lands first; this merge covers the
      // sender's own view when its socket missed the frame. Same id →
      // idempotent either way.
      mergeRows([
        {
          id: chatMessageId,
          work_item_id: workItemId,
          session_id: sessionId,
          sender_id: user.userId,
          sender_type: 'human',
          sender_name: user.email,
          content,
          message_type: 'text',
          metadata: { agent_prompt: true, command_id: command.id },
          created_at: command.created_at,
        },
      ]);
      return { command, chatMessageId };
    },
    [workItemId, mergeRows, session]
  );

  // Re-send un-acked messages after every (re)join: idempotent by client id —
  // a duplicate is acked with the stored row and never re-broadcast.
  useEffect(() => {
    if (roomStatus !== 'joined') return;
    for (const [id, pending] of pendingSendsRef.current) {
      if (pending.work_item_id !== workItemId) continue;
      sendEvent({
        type: 'chat_message',
        payload: {
          id,
          work_item_id: workItemId,
          // Carry the original thread — a resend that dropped it would land
          // the message as work-item history instead of in the thread the
          // sender chose.
          session_id: pending.session_id,
          content: pending.content,
          message_type: 'text',
        },
      });
    }
  }, [roomStatus, workItemId, sendEvent]);

  return { pendingIds, failedIds, sendMessage, sendPromptToAgent };
}
