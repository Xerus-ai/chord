import { createContext, useContext, useMemo } from 'react';
import type { TimelineCursor } from '@shared/session-stream-reducers';
import type { AgentTurn } from '@shared/stream-items';
import { useTurnStreamCore, type TurnStreamState } from './use-chat-messages';

/**
 * One turn-stream reducer per work item, shared by every surface that renders
 * agent turns (the chat and the right panel's Timeline tab).
 *
 * Each `useTurnStreamCore` call owns a reducer queue, two IPC subscriptions
 * and a canonical timeline fetch. Calling it from the Timeline tab — which is
 * mounted and unmounted on every right-panel tab switch — meant a second
 * reducer racing the chat's, rebuilt from scratch each time the user clicked
 * Timeline. This provider holds the one instance for both.
 */
const TurnStreamContext = createContext<TurnStreamState | null>(null);

export function TurnStreamProvider({
  workItemId,
  children,
}: {
  workItemId: string;
  children: React.ReactNode;
}) {
  const state = useTurnStreamCore(workItemId);
  return <TurnStreamContext.Provider value={state}>{children}</TurnStreamContext.Provider>;
}

function useTurnStream(): TurnStreamState {
  const state = useContext(TurnStreamContext);
  if (!state) {
    throw new Error('useTurnStream must be used inside a TurnStreamProvider');
  }
  return state;
}

export interface AgentTurnsState {
  turns: AgentTurn[];
  isSeeded: boolean;
  seedError: string | null;
}

/**
 * Non-empty turns in the work item's shared stream. `turns` is keyed by turn
 * id and each AgentTurn carries `sessionId` (the agent_sessions row id) when
 * known; turns persisted before Phase 1 have none and only appear unfiltered.
 */
function listTurns(turns: Map<string, AgentTurn>, sessionId?: string): AgentTurn[] {
  return Array.from(turns.values()).filter(
    (t) => t.items.length > 0 && (sessionId === undefined || t.sessionId === sessionId)
  );
}

/** @param sessionId When given, only that agent session's turns. */
export function useAgentTurns(sessionId?: string): AgentTurnsState {
  const { turns, isSeeded, seedError } = useTurnStream();
  const list = useMemo(() => listTurns(turns, sessionId), [turns, sessionId]);
  return { turns: list, isSeeded, seedError };
}

export interface SessionTimelineState {
  turns: AgentTurn[];
  cursor: TimelineCursor | undefined;
  isCatchingUp: boolean;
}

/** @param sessionId When given, only that agent session's turns. */
export function useSessionTimeline(sessionId?: string): SessionTimelineState {
  const { turns, cursor, isCatchingUp } = useTurnStream();
  const list = useMemo(() => listTurns(turns, sessionId), [turns, sessionId]);
  return { turns: list, cursor, isCatchingUp };
}
