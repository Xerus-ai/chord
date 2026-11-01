import {
  resolvePermissionMode,
  type AgentControlCatalog,
  type CatalogSelection,
} from '@shared/agent-control-catalog';
import type { AgentQuestion, AgentQuestionAnswers } from '@shared/agent-questions';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import type { ChatSessionHandle } from '@main/core/agent-sessions/chat-handle';
import type { ChatPermissionMode } from '@main/core/agent-sessions/permission-mode-store';
import { CodexAppServerClient } from './app-server-client';
import {
  isCodexApprovalRequest,
  MCP_ELICITATION_METHOD,
  toCodexApprovalResponse,
  toCodexPermissionRequest,
} from './codex-approvals';
import { buildCodexCatalog, listCodexModels } from './codex-catalog';
import { mapCodexNotification } from './codex-event-mapper';
import {
  DECLINED_ELICITATION,
  toCodexQuestions,
  toCodexUserInputResponse,
  USER_INPUT_METHOD,
} from './codex-questions';
import { buildCodexTurnOverrides, type CodexThreadPolicy } from './codex-turn-overrides';
import type { JsonValue } from './protocol/serde_json/JsonValue';
import type { McpServerElicitationRequestParams } from './protocol/v2/McpServerElicitationRequestParams';
import type { Model } from './protocol/v2/Model';
import type { ThreadItem } from './protocol/v2/ThreadItem';
import type { ThreadResumeParams } from './protocol/v2/ThreadResumeParams';
import type { ThreadResumeResponse } from './protocol/v2/ThreadResumeResponse';
import type { ThreadStartParams } from './protocol/v2/ThreadStartParams';
import type { ThreadStartResponse } from './protocol/v2/ThreadStartResponse';
import type { ToolRequestUserInputParams } from './protocol/v2/ToolRequestUserInputParams';
import type { TurnInterruptParams } from './protocol/v2/TurnInterruptParams';
import type { TurnStartParams } from './protocol/v2/TurnStartParams';
import type { TurnStartResponse } from './protocol/v2/TurnStartResponse';

export interface CodexSessionOptions {
  command: string;
  cwd: string;
  /** The thread to continue; a new thread is started without one. */
  resumeThreadId?: string;
  selection: CatalogSelection;
  /** Read at every turn: the mode can change between turns (the menu, an approved plan). */
  permissionMode: () => ChatPermissionMode;
  /**
   * Chord's `mcp_servers.chord` entry: thread config overrides, applied on
   * start and on resume alike, and the environment the server process needs
   * for them. The user's config file is untouched.
   */
  chordMcp?: { config: { [key: string]: JsonValue }; env: Record<string, string> };
  /** The lane environment the app-server runs with. */
  env?: Record<string, string>;
  onEvent: (event: AgentOutputEvent) => void;
  onThreadId: (threadId: string) => void;
  onStderr: (text: string) => void;
  onExit: (code: number | null) => void;
}

interface PendingApproval {
  id: number | string;
  method: string;
  params: unknown;
}

/**
 * The thread opens in the Codex app's default "Agent" mode: its workspace
 * sandbox, asking before stepping outside it. Other modes are per-turn
 * overrides; their requests become permission cards.
 */
const THREAD_POLICY = { approvalPolicy: 'on-request', sandbox: 'workspace-write' } as const;

/**
 * Codex features a session's server runs with. `request_permissions_tool`
 * (off by default in Codex 0.154) lets the agent ask mid-turn for access
 * beyond its sandbox; the request becomes a permission card.
 */
export const CODEX_SESSION_FEATURES = ['request_permissions_tool'] as const;

/**
 * One chat session on a Codex app-server thread. A message starts a turn that
 * carries the session's current model, effort, speed and collaboration mode;
 * a message sent while a turn runs waits for it to finish.
 */
class CodexSession implements ChatSessionHandle {
  private client!: CodexAppServerClient;
  private models: Model[] = [];
  private catalog!: AgentControlCatalog;
  private threadPolicy!: CodexThreadPolicy;
  private threadId = '';
  private activeTurnId: string | null = null;
  private lastCompletedTurnId: string | null = null;
  private turnStarting = false;
  private readonly queued: string[] = [];
  /** Tool items by id, so an approval request can name what it is about. */
  private readonly items = new Map<string, ThreadItem>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly questions = new Map<
    string,
    { id: number | string; questions: AgentQuestion[] }
  >();

  constructor(
    private readonly opts: CodexSessionOptions,
    private selection: CatalogSelection
  ) {}

  async open(): Promise<void> {
    this.client = await CodexAppServerClient.start({
      command: this.opts.command,
      cwd: this.opts.cwd,
      env:
        this.opts.chordMcp || this.opts.env
          ? { ...process.env, ...this.opts.env, ...this.opts.chordMcp?.env }
          : undefined,
      enableFeatures: CODEX_SESSION_FEATURES,
      handlers: {
        onNotification: (method, params) => this.handleNotification(method, params),
        onServerRequest: (id, method, params) => this.handleServerRequest(id, method, params),
        onStderr: this.opts.onStderr,
        onError: (e) => this.opts.onEvent({ type: 'error', message: e.message }),
        onExit: this.opts.onExit,
      },
    });
    try {
      await this.openThread();
    } catch (e) {
      this.client.close();
      throw e;
    }
  }

  private async openThread(): Promise<void> {
    this.models = await listCodexModels(this.client);
    this.catalog = buildCodexCatalog(this.models);
    const thread = this.opts.resumeThreadId
      ? await this.client.request<ThreadResumeResponse>('thread/resume', {
          threadId: this.opts.resumeThreadId,
          cwd: this.opts.cwd,
          ...THREAD_POLICY,
          config: this.opts.chordMcp?.config ?? null,
          excludeTurns: true,
        } satisfies ThreadResumeParams)
      : await this.client.request<ThreadStartResponse>('thread/start', {
          cwd: this.opts.cwd,
          ...THREAD_POLICY,
          config: this.opts.chordMcp?.config ?? null,
        } satisfies ThreadStartParams);
    this.threadId = thread.thread.id;
    this.threadPolicy = { approvalPolicy: thread.approvalPolicy, sandbox: thread.sandbox };
    this.opts.onThreadId(this.threadId);
  }

  sendMessage(text: string): void {
    if (this.activeTurnId !== null || this.turnStarting) {
      this.queued.push(text);
      return;
    }
    void this.startTurn(text);
  }

  async applySelection(selection: CatalogSelection): Promise<void> {
    this.selection = selection;
  }

  /** The mode is read from `opts.permissionMode` as each turn starts. */
  async setPermissionMode(): Promise<void> {}

  async interrupt(): Promise<void> {
    if (this.activeTurnId === null) return;
    await this.client.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    } satisfies TurnInterruptParams);
  }

  respondToPermission(requestId: string, optionId: string): boolean {
    const pending = this.approvals.get(requestId);
    if (!pending) return false;
    this.approvals.delete(requestId);
    this.client.respond(
      pending.id,
      toCodexApprovalResponse(optionId, pending.method, pending.params)
    );
    return true;
  }

  respondToQuestion(requestId: string, answers: AgentQuestionAnswers | null): boolean {
    const pending = this.questions.get(requestId);
    if (!pending) return false;
    this.questions.delete(requestId);
    this.client.respond(pending.id, toCodexUserInputResponse(pending.questions, answers));
    return true;
  }

  /** A Codex plan ends its turn; there is nothing parked to settle. */
  respondToPlan(): boolean {
    return false;
  }

  close(): void {
    this.client.close();
  }

  private async startTurn(text: string): Promise<void> {
    this.turnStarting = true;
    try {
      const mode = resolvePermissionMode(
        this.catalog,
        this.selection.model,
        this.opts.permissionMode()
      );
      if (!mode) throw new Error('Codex reported no permission modes');
      const overrides = buildCodexTurnOverrides(
        this.models,
        this.selection,
        mode.id,
        this.threadPolicy
      );
      const { turn } = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: this.threadId,
        input: [{ type: 'text', text, text_elements: [] }],
        ...overrides,
      } satisfies TurnStartParams);
      // `turn/started` normally names the turn first; a fast turn can even
      // complete before this reply arrives, and must not be revived by it.
      if (turn.id !== this.lastCompletedTurnId) this.activeTurnId = turn.id;
    } catch (e) {
      this.opts.onEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      this.opts.onEvent({ type: 'turn_completed' });
    } finally {
      this.turnStarting = false;
    }
    // A start that failed, or whose turn already completed, leaves the
    // session idle: the next queued message goes now, not after a later turn.
    this.startNextQueued();
  }

  /**
   * Starts the oldest queued message once nothing is running or starting —
   * the one place the queue drains, so a turn that completes while its
   * `turn/start` reply is still in flight cannot start a second turn early.
   */
  private startNextQueued(): void {
    if (this.activeTurnId !== null || this.turnStarting) return;
    const next = this.queued.shift();
    if (next !== undefined) void this.startTurn(next);
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === 'item/started') {
      const { item } = params as { item: ThreadItem };
      this.items.set(item.id, item);
    } else if (method === 'item/completed') {
      this.items.delete((params as { item: ThreadItem }).item.id);
    } else if (method === 'turn/started') {
      this.activeTurnId = (params as { turn: { id: string } }).turn.id;
    }
    for (const event of mapCodexNotification(method, params)) this.opts.onEvent(event);
    if (method === 'turn/completed') {
      this.activeTurnId = null;
      this.lastCompletedTurnId = (params as { turn: { id: string } }).turn.id;
      // Requests of a finished turn can no longer be answered.
      this.approvals.clear();
      this.questions.clear();
      this.startNextQueued();
    }
  }

  private handleServerRequest(id: number | string, method: string, params: unknown): void {
    const requestId = String(id);
    if (method === USER_INPUT_METHOD) {
      const questions = toCodexQuestions(params as ToolRequestUserInputParams);
      this.questions.set(requestId, { id, questions });
      this.opts.onEvent({ type: 'question_request', requestId, questions });
      return;
    }
    if (method === MCP_ELICITATION_METHOD && !isCodexApprovalRequest(method, params)) {
      // An MCP server's own form or URL flow: no card shows those.
      const { serverName } = params as McpServerElicitationRequestParams;
      this.client.respond(id, DECLINED_ELICITATION);
      this.opts.onEvent({
        type: 'error',
        message: `Declined a form from the ${serverName} MCP server: Chord cannot show MCP forms yet`,
      });
      return;
    }
    if (!isCodexApprovalRequest(method, params)) {
      // Nothing else has a card; refusing keeps the turn from hanging on an answer.
      this.client.respondError(id, -32601, `Chord cannot answer ${method}`);
      this.opts.onEvent({
        type: 'error',
        message: `Codex asked for ${method}, which Chord cannot answer`,
      });
      return;
    }
    // An MCP elicitation names no item; command, file and permission requests do.
    const itemId = (params as { itemId?: string }).itemId;
    this.approvals.set(requestId, { id, method, params });
    const item = itemId === undefined ? undefined : this.items.get(itemId);
    this.opts.onEvent(toCodexPermissionRequest(requestId, method, params, item));
  }
}

/** Starts (or resumes) a Codex thread; resolves once it is ready for messages. */
export async function startCodexSession(opts: CodexSessionOptions): Promise<ChatSessionHandle> {
  const session = new CodexSession(opts, opts.selection);
  await session.open();
  return session;
}
