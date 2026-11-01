import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useSyncSocketContext } from '@renderer/lib/sync/sync-socket-provider';
import type { TypingPerson } from './typing-line';

const TYPING_TIMEOUT_MS = 3_000;
const DEBOUNCE_MS = 300;

// Typing state is keyed by the work item it was collected for, so entries
// from a previously watched work item never leak into the current one.
interface TypingState {
  workItemId: string;
  users: Map<string, TypingPerson>;
}

const NO_TYPING_USERS: TypingPerson[] = [];

export function useTypingIndicators(workItemId: string | undefined) {
  const { subscribeEvent } = useSyncSocketContext();
  const { data: session } = useAccountSession();
  const selfId = session?.user?.userId ?? null;
  const [state, setState] = useState<TypingState | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!workItemId) return;

    const removeUser = (user_id: string) => {
      setState((prev) => {
        if (!prev || prev.workItemId !== workItemId || !prev.users.has(user_id)) return prev;
        const users = new Map(prev.users);
        users.delete(user_id);
        return { workItemId, users };
      });
    };

    const unsubscribe = subscribeEvent(
      'typing_indicator_changed',
      ({ user_id, email, is_typing }) => {
        // The server excludes the sending SOCKET, not the sending user — with
        // the same account signed in to two windows, one window's typing
        // reaches the other and renders "you are typing" back at yourself.
        if (user_id === selfId) return;
        if (is_typing) {
          setState((prev) => {
            const users = prev && prev.workItemId === workItemId ? new Map(prev.users) : new Map();
            // The line names them from the roster (typing-line.ts); the email
            // stands in for someone it has no name for. The raw user_id is a
            // UUID and is never rendered.
            users.set(user_id, { userId: user_id, email });
            return { workItemId, users };
          });

          const existing = timersRef.current.get(user_id);
          if (existing) clearTimeout(existing);
          timersRef.current.set(
            user_id,
            setTimeout(() => {
              removeUser(user_id);
              timersRef.current.delete(user_id);
            }, TYPING_TIMEOUT_MS)
          );
        } else {
          removeUser(user_id);
          const existing = timersRef.current.get(user_id);
          if (existing) {
            clearTimeout(existing);
            timersRef.current.delete(user_id);
          }
        }
      },
      workItemId
    );

    const timers = timersRef.current;
    return () => {
      unsubscribe();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, [subscribeEvent, workItemId, selfId]);

  if (!state || state.workItemId !== workItemId || state.users.size === 0) {
    return NO_TYPING_USERS;
  }
  return Array.from(state.users.values());
}

export function useTypingSender(workItemId: string | undefined) {
  const { sendEvent } = useSyncSocketContext();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef(false);

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!workItemId) return;

      if (isTyping) {
        if (debounceRef.current) return;
        if (!lastSentRef.current) {
          const sent = sendEvent({
            type: 'typing_indicator',
            payload: { work_item_id: workItemId, is_typing: true },
          });
          if (!sent) return;
          lastSentRef.current = true;
        }
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          lastSentRef.current = false;
        }, DEBOUNCE_MS);
      } else {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        if (lastSentRef.current) {
          sendEvent({
            type: 'typing_indicator',
            payload: { work_item_id: workItemId, is_typing: false },
          });
          lastSentRef.current = false;
        }
      }
    },
    [sendEvent, workItemId]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return sendTyping;
}
