import { useCallback, useEffect, useRef } from 'react';
import { turnStreamChannel, type TurnStreamAction } from '@shared/stream-items';
import { events } from '@renderer/lib/ipc';

/**
 * How long an untargeted send waits for its session to start a turn. Covers an
 * agent's cold start; past it a turn is more likely someone else's than this send's.
 */
const UNTARGETED_FOCUS_WINDOW_MS = 120_000;

function startsTurn(action: TurnStreamAction): boolean {
  if (action.type === 'items_batch') return action.actions.some(startsTurn);
  return action.type === 'turn_started';
}

/** Asks the owner view to show a session: its tab activates where it is, else opens in the focused pane. */
function showSession(sessionId: string) {
  window.dispatchEvent(
    new CustomEvent('chord:switch-tab', { detail: { kind: 'session', sessionId } })
  );
}

/**
 * Brings the session a Room send reached to the front — only for the user's
 * own send, never for sessions others or background events start.
 *
 * Arm it right before sending. A send to a known session shows that session
 * as soon as it streams or delivery succeeds. An untargeted send doesn't know
 * its session (the item's default one, possibly started for this message), so
 * it shows the first session that starts a turn after arming, within
 * `UNTARGETED_FOCUS_WINDOW_MS`. Failed delivery, the next send, and unmount
 * disarm it.
 */
export function useFocusSentSession(workItemId: string) {
  const disarmRef = useRef<(() => void) | null>(null);
  useEffect(() => () => disarmRef.current?.(), []);

  return useCallback(
    (sessionId: string | null) => {
      disarmRef.current?.();
      let armed = true;
      const disarm = () => {
        if (!armed) return;
        armed = false;
        clearTimeout(timeout);
        off();
        disarmRef.current = null;
      };
      const reveal = (id: string) => {
        if (!armed) return;
        disarm();
        showSession(id);
      };
      const off = events.on(
        turnStreamChannel,
        (event) => {
          if (!event.sessionId) return;
          if (sessionId !== null ? event.sessionId === sessionId : startsTurn(event.action)) {
            reveal(event.sessionId);
          }
        },
        workItemId
      );
      const timeout =
        sessionId === null ? setTimeout(disarm, UNTARGETED_FOCUS_WINDOW_MS) : undefined;
      disarmRef.current = disarm;
      return {
        /** Delivery settled: show a known target, keep waiting for an unknown one's turn, or give up. */
        settle: (delivered: boolean) => {
          if (!delivered) disarm();
          else if (sessionId !== null) reveal(sessionId);
        },
      };
    },
    [workItemId]
  );
}
