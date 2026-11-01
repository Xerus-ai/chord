import { useCallback, useEffect, useRef, useState } from 'react';
import { chatMessageChannel, type ChatMessageEvent } from '@shared/events/chatEvents';
import {
  createStreamReducerQueue,
  replaceFromCanonical,
  type ReducerSideEffect,
  type SessionStreamState,
  type TimelineCursor,
} from '@shared/session-stream-reducers';
import { turnStreamChannel, type AgentTurn, type TurnStreamEvent } from '@shared/stream-items';
import { cloudApi } from '@renderer/lib/cloud-api';
import { captureException } from '@renderer/lib/error-tracking/error-tracking';
import { events, rpc } from '@renderer/lib/ipc';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import { compareChatEntries, mergeChatEntries } from './chat-entry-merge';
import { cloudMessageToChatEntry, dbRowToChatEntry } from './chat-message-transform';
import type { ChatEntry } from './chat-types';
import { describeThrownFailure } from './describe-action-failure';
import { chatEventToTurn, timelineRowToTurn } from './turn-records';

export function useChatMessages(workItemId: string) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const { subscribeEvent } = useSyncSocketContext();

  useEffect(() => {
    let stale = false;
    // Live rows that land before the history SELECT resolves are held here
    // instead of being pushed into state: the seed replaces state (switching
    // work items must not keep the previous item's rows), so anything already
    // committed would be discarded. The seed folds the buffer back in.
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

    const seedWith = (local: ChatEntry[]) => {
      seeded = true;
      const merged = mergeChatEntries(local, buffered);
      buffered.length = 0;
      setMessages(merged);
      return merged;
    };

    rpc.chatMessages
      .getMessages(workItemId)
      .then((result) => {
        if (stale) return;
        const seedRows = seedWith(result.data.messages.map(dbRowToChatEntry));
        const seedIds = new Set(seedRows.map((m) => m.id));
        cloudApi
          .getMessages(workItemId, { limit: 500 })
          .then((cloudRows) => {
            if (stale) return;
            const fresh = cloudRows.filter((r) => !seedIds.has(r.id));
            if (fresh.length === 0) return;
            setMessages((prev) => {
              const merged = mergeChatEntries(prev, fresh.map(cloudMessageToChatEntry));
              if (merged === prev) return prev;
              return [...merged].sort(compareChatEntries);
            });
          })
          .catch((e: unknown) => captureException(e, { operation: 'chat_history_cloud_fetch' }));
      })
      .catch((e: unknown) => {
        if (stale) return;
        // The local history is gone, but the live listeners are still the
        // only source for what arrives next — flush them rather than leaving
        // the buffer stranded behind a seed that will never come.
        seedWith([]);
        captureException(e, { operation: 'chat_history_local_load' });
      });

    const offLocal = events.on(
      chatMessageChannel,
      (event: ChatMessageEvent) => receive([dbRowToChatEntry(event)]),
      workItemId
    );

    const offCloud = subscribeEvent(
      'chat_message_received',
      (payload) => receive([cloudMessageToChatEntry(payload)]),
      workItemId
    );

    // Owner history bulk pushes (PUT /bulk) land as one frame carrying every
    // newly-inserted row above the server's INDIVIDUAL_BROADCAST_MAX — same
    // dedupe-by-id merge as chat_message_received above, just for the whole
    // batch in one setMessages call instead of one per row.
    const offCloudBulk = subscribeEvent(
      'chat_messages_bulk_received',
      (payload) => receive(payload.messages.map(cloudMessageToChatEntry)),
      workItemId
    );

    return () => {
      stale = true;
      offLocal();
      offCloud();
      offCloudBulk();
    };
  }, [workItemId, subscribeEvent]);

  return messages;
}

export interface TurnStreamState {
  turns: Map<string, AgentTurn>;
  cursor: TimelineCursor | undefined;
  isCatchingUp: boolean;
  /**
   * The canonical seed has settled. Until it does, "this item has no turns" is
   * indistinguishable from "the turns have not arrived yet" — which is what
   * used to make the chat render its pre-turns layout and then swap.
   */
  isSeeded: boolean;
  seedError: string | null;
}

/**
 * The single turn-stream reducer for a work item. Mount it once per item (see
 * turn-stream-context) — every extra mount is another reducer queue, another
 * pair of event subscriptions, and another canonical fetch for the same data.
 */
export function useTurnStreamCore(workItemId: string): TurnStreamState {
  const [turns, setTurns] = useState<Map<string, AgentTurn>>(new Map());
  const [cursor, setCursor] = useState<TimelineCursor | undefined>(undefined);
  const [isCatchingUp, setIsCatchingUp] = useState(false);
  const [isSeeded, setIsSeeded] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const stateRef = useRef<SessionStreamState>({ turns: new Map(), cursor: undefined });
  const catchUpInFlightRef = useRef(false);

  const commitState = useCallback((next: SessionStreamState) => {
    stateRef.current = next;
    setTurns(next.turns);
    setCursor(next.cursor);
  }, []);

  const handleSideEffects = useCallback(
    (effects: ReducerSideEffect[]) => {
      for (const effect of effects) {
        if (effect.type !== 'catch_up' || catchUpInFlightRef.current) continue;
        catchUpInFlightRef.current = true;
        setIsCatchingUp(true);
        rpc.chatMessages
          .getTimelineTurns({ workItemId })
          .then((result) => {
            setSeedError(null);
            // Canonical wins: the main process holds the full item list for
            // both completed and in-flight turns. Local streaming turns are
            // kept only when canonical doesn't know them yet (a turn that
            // started after the snapshot was taken).
            const canonical = new Map<string, AgentTurn>();
            for (const row of result.data.turns) {
              canonical.set(row.turnId, timelineRowToTurn(workItemId, row));
            }
            for (const [id, turn] of stateRef.current.turns) {
              if (turn.status === 'streaming' && !canonical.has(id)) {
                canonical.set(id, turn);
              }
            }
            const output = replaceFromCanonical(canonical, null);
            commitState({ turns: output.turns, cursor: output.cursor });
          })
          .catch((e: unknown) =>
            setSeedError(describeThrownFailure('Reload the agent timeline', e))
          )
          .finally(() => {
            catchUpInFlightRef.current = false;
            setIsCatchingUp(false);
          });
      }
    },
    [workItemId, commitState]
  );

  useEffect(() => {
    stateRef.current = { turns: new Map(), cursor: undefined };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on workItemId change
    setTurns(new Map());
    setCursor(undefined);
    setIsSeeded(false);
    setSeedError(null);

    const queue = createStreamReducerQueue({
      getState: () => stateRef.current,
      commit: (output) => commitState({ turns: output.turns, cursor: output.cursor }),
      handleSideEffects,
    });

    // Seed from the canonical timeline: persisted turns plus the in-flight
    // turn held by the main process, so a mount mid-stream starts complete
    // instead of waiting for the next live event.
    // getTimelineTurns only ever resolves Ok — a real failure rejects the IPC
    // promise, so the catch below is the whole error path.
    rpc.chatMessages
      .getTimelineTurns({ workItemId })
      .then((result) => {
        const loaded = new Map(stateRef.current.turns);
        for (const row of result.data.turns) {
          const local = loaded.get(row.turnId);
          // Snapshot wins over a locally-accumulated partial streaming turn
          // (it has the items from before we subscribed); text/tool updates
          // re-carry full item state, so any delta lost in the swap heals on
          // the next live event.
          if (!local || local.status === 'streaming') {
            loaded.set(row.turnId, timelineRowToTurn(workItemId, row));
          }
        }
        commitState({ ...stateRef.current, turns: loaded });
      })
      .catch((e: unknown) => setSeedError(describeThrownFailure('Load the agent timeline', e)))
      // Seeded means "the canonical answer is in", success or not: a failed
      // seed must still release the render, or the chat waits forever.
      .finally(() => setIsSeeded(true));

    const offStream = events.on(
      turnStreamChannel,
      (event: TurnStreamEvent) => {
        queue.enqueue(event.turnId, event.workItemId, {
          action: event.action,
          seq: event.seq,
          epoch: event.epoch,
          sessionId: event.sessionId,
          timestamp: Date.now(),
        });
      },
      workItemId
    );

    // Fallback of last resort: completed turns are persisted and broadcast as
    // agent_turn chat messages. Merging them here guarantees a finished turn
    // lands even if every live stream event for it was lost.
    const offCompleted = events.on(
      chatMessageChannel,
      (event: ChatMessageEvent) => {
        try {
          const turn = chatEventToTurn(workItemId, event);
          if (!turn) return;
          const next = new Map(stateRef.current.turns);
          next.set(turn.id, turn);
          commitState({ ...stateRef.current, turns: next });
        } catch {
          /* skip malformed */
        }
      },
      workItemId
    );

    return () => {
      offStream();
      offCompleted();
      queue.dispose({ flush: true });
    };
  }, [workItemId, handleSideEffects, commitState]);

  return { turns, cursor, isCatchingUp, isSeeded, seedError };
}
