import type { CloudChatMessage } from '@chord/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { chatMessageChannel, type ChatMessageEvent } from '@shared/events/chatEvents';
import { cloudApi } from '@renderer/lib/cloud-api';
import { captureException } from '@renderer/lib/error-tracking/error-tracking';
import { events, rpc } from '@renderer/lib/ipc';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { compareChatEntries, mergeChatEntries } from './chat-entry-merge';
import {
  cloudMessageToChatEntry,
  dbRowToChatEntry,
  sessionCloudEntries,
} from './chat-message-transform';
import type { ChatEntry } from './chat-types';

/**
 * The chat rows one agent session produced (`chat_messages.session_id`).
 *
 * Local history first, then the work item's cloud rows scoped to this session
 * (rows never ingested locally), plus live local and cloud-socket rows — all
 * deduped by id. Same seed-then-merge buffering as `useChatMessages`, so a
 * live row that lands before history resolves is not lost when the seed
 * replaces state.
 *
 * `seeded` says history is in (local rows and the cloud gap-fill); `mergeCloudRows` adds rows a reveal read
 * from the cloud (shared-items step 5) through the same buffer, for the one
 * case this machine lacks: a row ingestion missed, older than the cloud page.
 */
export function useSessionChatMessages(workItemId: string, sessionId: string) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const { subscribeEvent } = useSyncSocketContext();
  const receiveRef = useRef<(entries: ChatEntry[]) => void>(() => {});

  useEffect(() => {
    let stale = false;
    let seeded = false;
    const buffered: ChatEntry[] = [];

    const receive = (entries: ChatEntry[]) => {
      if (stale || entries.length === 0) return;
      if (!seeded) {
        buffered.push(...entries);
        return;
      }
      setMessages((prev) => mergeChatEntries(prev, entries));
    };

    receiveRef.current = receive;

    const seedWith = (rows: ChatEntry[]) => {
      seeded = true;
      setMessages(mergeChatEntries(rows, buffered));
      buffered.length = 0;
    };
    // History is in once the cloud gap-fill has settled too: rows this machine
    // never ingested land there, and a reveal placed before them would see
    // them arrive above its row.
    const markHistoryIn = () => {
      if (!stale) setSeededKey(`${workItemId}:${sessionId}`);
    };

    // Turns render from the timeline (useAgentTurns); their rows here would
    // only be mapped to placeholders and dropped (selectThreadEntries).
    rpc.chatMessages
      .getMessages(workItemId, { sessionId, withoutTurns: true })
      .then((result) => {
        if (stale) return;
        seedWith(result.data.messages.map(dbRowToChatEntry));
        cloudApi
          .getMessages(workItemId, { limit: 500 })
          .then((cloudRows) => {
            if (stale) return;
            const fresh = sessionCloudEntries(cloudRows, sessionId);
            if (fresh.length === 0) return;
            setMessages((prev) => {
              const merged = mergeChatEntries(prev, fresh);
              if (merged === prev) return prev;
              return [...merged].sort(compareChatEntries);
            });
          })
          .catch((e: unknown) => captureException(e, { operation: 'session_history_cloud_fetch' }))
          .finally(markHistoryIn);
      })
      .catch((e: unknown) => {
        if (stale) return;
        seedWith([]);
        markHistoryIn();
        captureException(e, { operation: 'session_history_local_load' });
      });

    const offLocal = events.on(
      chatMessageChannel,
      (event: ChatMessageEvent) => {
        if (event.sessionId !== sessionId) return;
        receive([dbRowToChatEntry(event)]);
      },
      workItemId
    );

    const offCloud = subscribeEvent(
      'chat_message_received',
      (payload) => receive(sessionCloudEntries([payload], sessionId)),
      workItemId
    );

    const offCloudBulk = subscribeEvent(
      'chat_messages_bulk_received',
      (payload) => receive(sessionCloudEntries(payload.messages, sessionId)),
      workItemId
    );

    return () => {
      stale = true;
      offLocal();
      offCloud();
      offCloudBulk();
    };
  }, [workItemId, sessionId, subscribeEvent]);

  const mergeCloudRows = useCallback((rows: readonly CloudChatMessage[]) => {
    receiveRef.current(rows.map(cloudMessageToChatEntry));
  }, []);

  return {
    entries: messages,
    seeded: seededKey === `${workItemId}:${sessionId}`,
    mergeCloudRows,
  };
}
