import type {
  AcpFileLocation,
  AcpPermissionOption,
  AcpToolCallStatus,
  AcpToolContent,
} from '../acp-types';
import type { AgentQuestion } from '../agent-questions';
import type { UsageWindow } from '../usage-window';

export type AgentOutputEvent =
  | { type: 'text'; text: string; messageId?: string }
  /** A new text content block opened. Consecutive blocks are separate
   *  paragraphs even when nothing else was streamed between them. */
  | { type: 'text_block_start' }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool_call';
      callId: string;
      name: string;
      status: AcpToolCallStatus;
      kind?: string;
      title?: string;
      rawInput?: Record<string, unknown>;
      content?: AcpToolContent[];
      locations?: AcpFileLocation[];
    }
  | {
      type: 'tool_call_update';
      callId: string;
      status: AcpToolCallStatus;
      rawInput?: Record<string, unknown>;
      content?: AcpToolContent[];
    }
  | {
      type: 'permission_request';
      requestId: string;
      name: string;
      kind: string;
      title?: string;
      input?: Record<string, unknown>;
      options: AcpPermissionOption[];
    }
  | { type: 'plan'; entries: { text: string; status: string }[] }
  | {
      /**
       * A parked ExitPlanMode call: the agent presented a plan and is blocked
       * inside the tool's permission callback until the plan is approved,
       * adjusted, or rejected (claude-sdk-session parks the PermissionResult
       * keyed by requestId). `plan` is the raw markdown from the tool input.
       */
      type: 'plan_request';
      requestId: string;
      plan: string;
      /** The agent's own draft file (e.g. ~/.claude/plans/*.md) — never an artifact. */
      planFilePath?: string;
      entries: { text: string; status: string }[];
    }
  | {
      /**
       * A parked question (Claude AskUserQuestion, Codex request_user_input):
       * the agent waits inside its turn until respondToQuestion answers it.
       */
      type: 'question_request';
      requestId: string;
      questions: AgentQuestion[];
    }
  | { type: 'error'; message: string }
  | { type: 'turn_started' }
  | {
      type: 'turn_completed';
      usage?: UsageInfo;
      /**
       * Where the agent's conversation can be cut after this turn (Reset,
       * Fork): Claude's last main-chain transcript entry uuid, Codex's turn
       * id. Absent where the agent reports none.
       */
      historyRef?: string;
    }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; totalCostUsd?: number }
  | { type: 'config_update'; key: string; value: unknown }
  /** How full the context window is — the ring in the composer. */
  | { type: 'context_usage'; usedTokens: number; maxTokens: number }
  /** Plan usage windows (5-hour, weekly…) as the provider reports them. */
  | { type: 'rate_limit'; windows: UsageWindow[] };

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
}
