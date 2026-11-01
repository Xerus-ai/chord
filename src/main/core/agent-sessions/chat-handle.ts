import type { CatalogSelection } from '@shared/agent-control-catalog';
import type { AgentQuestionAnswers } from '@shared/agent-questions';

/**
 * A live chat session Chord drives in-process over a structured protocol —
 * a Claude Agent SDK query or a Codex app-server thread. Session code talks
 * to this, never to a transport, so every such agent gets live model/mode
 * switches, interrupts and permission answers through one path.
 */
export interface ChatSessionHandle {
  /** Delivers a user message; one sent mid-turn is taken after the running turn. */
  sendMessage: (text: string) => void;
  /** Applies a model/effort/fast pick from the next turn on, keeping the conversation. */
  applySelection: (selection: CatalogSelection) => Promise<void>;
  /** Switches to a mode id from the session's catalog (already resolved, never null). */
  setPermissionMode: (mode: string) => Promise<void>;
  interrupt: () => Promise<void>;
  /** Answers a pending permission card. False when this session does not own `requestId`. */
  respondToPermission: (requestId: string, optionId: string) => boolean;
  /**
   * Answers a pending question card; `answers` null dismisses it. False when
   * this session does not own `requestId`.
   */
  respondToQuestion: (requestId: string, answers: AgentQuestionAnswers | null) => boolean;
  /**
   * Settles a plan the agent parked for approval inside its turn. False when
   * the session has no such parked plan — the decision is then sent as a
   * prompt instead.
   */
  respondToPlan: (
    requestId: string,
    action: 'approve' | 'reject' | 'adjust',
    feedback?: string
  ) => boolean;
  close: () => void;
}
