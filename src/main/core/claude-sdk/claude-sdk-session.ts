import type {
  EffortLevel,
  McpSdkServerConfigWithInstance,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  Query,
} from '@anthropic-ai/claude-agent-sdk';
import type { AcpPermissionOption } from '@shared/acp-types';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import { CHORD_MCP_SERVER_NAME } from '@main/core/agent-artifact-tools/chord-server-name';
import type { ChatSessionHandle } from '@main/core/agent-sessions/chat-handle';
import { TransportError } from '@main/core/agent-sessions/errors';
import { log } from '@main/lib/logger';
import { resolvePackagedClaudeExecutable } from './claude-executable-path';
import { buildClaudeFlagSettings } from './claude-flag-settings';
import type { ClaudeProjectGate } from './claude-project-gate';
import {
  ASK_USER_QUESTION_TOOL,
  toClaudeAnsweredInput,
  toClaudeQuestions,
} from './claude-questions';
import { consumeStream } from './consume-sdk-stream';
import { buildPathTranslationHooks } from './path-translation-hooks';
import { buildPublishNudgeHooks } from './publish-nudge-hooks';
import { createMessageInput, toUserMessage } from './sdk-message-input';
import { parsePlanText } from './sdk-message-translator';

export interface ClaudeSDKSessionOptions {
  initialPrompt?: string;
  cwd: string;
  workItemId: string;
  model?: string;
  effort?: EffortLevel;
  fast: boolean;
  permissionMode?: PermissionMode;
  /** Chord's artifact tools; null while "Let agents create artifacts" is off. */
  chordMcpServer: McpSdkServerConfigWithInstance | null;
  /** How the repository's Claude config loads (`claude-project-gate.ts`). */
  projectGate: ClaudeProjectGate;
  sessionId?: string;
  isResuming?: boolean;
  /** The lane environment, layered over Chord's own. */
  env?: Record<string, string>;
  abortController: AbortController;
  onEvent: (event: AgentOutputEvent) => void;
  onSessionId: (externalSessionId: string) => void;
  /** The mode the CLI reports running in — at start, and whenever it changes (e.g. leaving plan). */
  onPermissionMode: (mode: PermissionMode) => void;
  onExit: (code: number) => void;
}

/** The Claude transport's handle: the shared chat controls plus its plan-approval tool gate. */
export interface ClaudeSDKSessionHandle extends ChatSessionHandle {
  /** Blocks all subsequent canUseTool calls until releaseToolsForPlan is called. */
  holdToolsForPlan: () => void;
  /** Releases the plan gate so blocked canUseTool calls proceed. */
  releaseToolsForPlan: () => void;
}

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  toolUseID: string;
  /** An AskUserQuestion call: settled by respondToQuestion, never by a permission answer. */
  isQuestion?: boolean;
}

export async function startClaudeSDKSession(
  opts: ClaudeSDKSessionOptions
): Promise<ClaudeSDKSessionHandle> {
  const input = createMessageInput();
  const pendingPermissions = new Map<string, PendingPermission>();
  let q: Query;

  let planGatePromise: Promise<void> | null = null;
  let planGateResolve: (() => void) | null = null;

  function releasePlanGate(): void {
    if (!planGateResolve) return;
    planGateResolve();
    planGateResolve = null;
    planGatePromise = null;
  }

  function resolvePermission(requestId: string, result: PermissionResult): void {
    const pending = pendingPermissions.get(requestId);
    if (!pending) return;
    pendingPermissions.delete(requestId);
    pending.resolve(result);
  }

  // Without this callback the SDK auto-denies every gated tool call and the
  // model answers in prose ("please approve...") with nothing rendered in the
  // UI. The prompt is parked until the user answers the emitted
  // permission_request via respondToPermission — the SDK sets no deadline.
  async function requestToolPermission(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: {
      signal: AbortSignal;
      suggestions?: PermissionUpdate[];
      title?: string;
      toolUseID: string;
      requestId: string;
    }
  ): Promise<PermissionResult> {
    if (planGatePromise) {
      await planGatePromise;
    }

    // EnterPlanMode is not a user-facing gate: it only switches the CLI into
    // plan mode. Suggestions are passed through so the CLI applies its
    // proposed mode transition.
    if (/^enter_?plan_?mode$/i.test(toolName)) {
      return {
        behavior: 'allow',
        updatedInput: toolInput,
        updatedPermissions: context.suggestions,
        toolUseID: context.toolUseID,
      };
    }

    // ExitPlanMode IS the plan-approval gate. The call parks here — blocking
    // the agent's turn inside the tool — while the plan card rendered from
    // the tool INPUT (`plan` is the raw markdown) awaits the user's decision.
    // Approve resolves allow (the CLI leaves plan mode and continues the same
    // turn); adjust/reject resolve deny with the feedback as the message (the
    // CLI stays in plan mode and revises). This is what makes approval a
    // protocol reply instead of an injected "Plan approved" prompt that used
    // to trigger a spurious extra turn after implementation.
    if (/^exit_?plan_?mode$/i.test(toolName)) {
      const planText = typeof toolInput.plan === 'string' ? toolInput.plan : '';
      return new Promise<PermissionResult>((resolve) => {
        pendingPermissions.set(context.requestId, {
          resolve,
          input: toolInput,
          suggestions: context.suggestions,
          toolUseID: context.toolUseID,
        });

        context.signal.addEventListener(
          'abort',
          () => {
            resolvePermission(context.requestId, {
              behavior: 'deny',
              message: 'The plan request was aborted before the user responded.',
              toolUseID: context.toolUseID,
            });
          },
          { once: true }
        );

        opts.onEvent({
          type: 'plan_request',
          requestId: context.requestId,
          plan: planText,
          planFilePath:
            typeof toolInput.planFilePath === 'string' ? toolInput.planFilePath : undefined,
          entries: parsePlanText(planText),
        });
      });
    }

    // AskUserQuestion parks the same way, but its card is the question card,
    // answered through respondToQuestion.
    const isQuestion = toolName === ASK_USER_QUESTION_TOOL;
    return new Promise<PermissionResult>((resolve) => {
      pendingPermissions.set(context.requestId, {
        resolve,
        input: toolInput,
        suggestions: context.suggestions,
        toolUseID: context.toolUseID,
        isQuestion,
      });

      context.signal.addEventListener(
        'abort',
        () => {
          resolvePermission(context.requestId, {
            behavior: 'deny',
            message: 'Tool use aborted before the user responded.',
            toolUseID: context.toolUseID,
          });
        },
        { once: true }
      );

      if (isQuestion) {
        opts.onEvent({
          type: 'question_request',
          requestId: context.requestId,
          questions: toClaudeQuestions(toolInput),
        });
        return;
      }

      const options: AcpPermissionOption[] = [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
      ];
      if (context.suggestions?.length) {
        options.push({ optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' });
      }
      options.push({ optionId: 'reject_once', name: 'Deny', kind: 'reject_once' });

      opts.onEvent({
        type: 'permission_request',
        requestId: context.requestId,
        name: toolName,
        kind: 'tool',
        title: context.title,
        input: toolInput,
        options,
      });
    });
  }

  try {
    // Loaded on first use so the Claude Agent SDK stays out of the startup module graph.
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    q = query({
      prompt: input.iterable,
      options: {
        model: opts.model,
        effort: opts.effort,
        // Chord's settings outrank the repository's: the gate's overrides
        // keep what the user did not approve from running.
        settings: {
          ...buildClaudeFlagSettings({
            fast: opts.fast,
            chordArtifactsEnabled: opts.chordMcpServer !== null,
          }),
          ...opts.projectGate.settings,
        },
        settingSources: opts.projectGate.settingSources,
        // The one query() a session runs, fresh or resumed: the chord server
        // rides on both, so a resumed conversation keeps its publish tool.
        mcpServers: opts.chordMcpServer
          ? { [CHORD_MCP_SERVER_NAME]: opts.chordMcpServer }
          : undefined,
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : undefined,
        pathToClaudeCodeExecutable: resolvePackagedClaudeExecutable(),
        permissionMode: opts.permissionMode ?? 'default',
        // Lets the mode menu switch to Full access; the session starts in the mode above.
        allowDangerouslySkipPermissions: true,
        canUseTool: (toolName, toolInput, context) =>
          requestToolPermission(toolName, toolInput, context),
        abortController: opts.abortController,
        resume: opts.isResuming && opts.sessionId ? opts.sessionId : undefined,
        hooks: {
          ...buildPathTranslationHooks(opts.cwd),
          // Only with the publish tool: a nudge toward a tool the agent lacks is noise.
          ...(opts.chordMcpServer
            ? buildPublishNudgeHooks({ workItemId: opts.workItemId, cwd: opts.cwd })
            : {}),
        },
        persistSession: true,
        includePartialMessages: true,
        forwardSubagentText: true,
      },
    });
  } catch (e) {
    throw new TransportError(`Failed to create Claude SDK session: ${String(e)}`, 'claude');
  }

  if (opts.initialPrompt) {
    input.push(toUserMessage(opts.initialPrompt));
  }

  consumeStream(q, opts).catch((e) => {
    if (opts.abortController.signal.aborted) return;
    log.error('claude-sdk-session: stream error', { error: String(e) });
    opts.onEvent({ type: 'error', message: String(e) });
    opts.onExit(1);
  });

  return {
    sendMessage: (text: string) => {
      input.push(toUserMessage(text));
    },
    applySelection: async (selection) => {
      await q.setModel(selection.model ?? undefined);
      await q.applyFlagSettings({
        // Narrowed against the probed catalog, whose levels are the SDK's own.
        effortLevel: selection.effort as EffortLevel | null,
        fastMode: selection.fast,
      });
    },
    setPermissionMode: async (mode) => {
      // Resolved against the probed catalog, whose ids are the SDK's own.
      await q.setPermissionMode(mode as PermissionMode);
    },
    interrupt: async () => {
      try {
        await q.interrupt();
      } catch (e) {
        log.debug('claude-sdk-session: interrupt error', { error: String(e) });
      }
    },
    holdToolsForPlan: () => {
      if (!planGatePromise) {
        planGatePromise = new Promise<void>((resolve) => {
          planGateResolve = resolve;
        });
      }
    },
    releaseToolsForPlan: releasePlanGate,
    respondToPlan: (
      requestId: string,
      action: 'approve' | 'reject' | 'adjust',
      feedback?: string
    ): boolean => {
      const pending = pendingPermissions.get(requestId);
      if (!pending || pending.isQuestion) return false;

      if (action === 'approve') {
        resolvePermission(requestId, {
          behavior: 'allow',
          updatedInput: pending.input,
          // The CLI's proposed mode transition out of plan mode rides on the
          // suggestions — without them approval leaves the session planning.
          updatedPermissions: pending.suggestions,
          toolUseID: pending.toolUseID,
        });
      } else {
        const message =
          action === 'adjust' && feedback
            ? `The user wants the plan adjusted before approval: ${feedback}`
            : 'The user rejected this plan. Stay in plan mode and propose a different approach.';
        resolvePermission(requestId, {
          behavior: 'deny',
          message,
          toolUseID: pending.toolUseID,
        });
      }
      return true;
    },
    respondToQuestion: (requestId, answers) => {
      const pending = pendingPermissions.get(requestId);
      if (!pending?.isQuestion) return false;
      resolvePermission(
        requestId,
        answers === null
          ? {
              behavior: 'deny',
              message: 'The user dismissed the question without answering.',
              toolUseID: pending.toolUseID,
            }
          : {
              behavior: 'allow',
              updatedInput: toClaudeAnsweredInput(pending.input, answers),
              toolUseID: pending.toolUseID,
            }
      );
      return true;
    },
    respondToPermission: (requestId: string, optionId: string): boolean => {
      const pending = pendingPermissions.get(requestId);
      if (!pending || pending.isQuestion) return false;

      if (optionId === 'allow_always') {
        resolvePermission(requestId, {
          behavior: 'allow',
          updatedInput: pending.input,
          updatedPermissions: pending.suggestions,
          toolUseID: pending.toolUseID,
        });
      } else if (optionId === 'allow_once') {
        resolvePermission(requestId, {
          behavior: 'allow',
          updatedInput: pending.input,
          toolUseID: pending.toolUseID,
        });
      } else {
        resolvePermission(requestId, {
          behavior: 'deny',
          message: 'The user denied this tool use.',
          toolUseID: pending.toolUseID,
        });
      }
      return true;
    },
    close: () => {
      releasePlanGate();
      for (const requestId of [...pendingPermissions.keys()]) {
        const pending = pendingPermissions.get(requestId)!;
        resolvePermission(requestId, {
          behavior: 'deny',
          message: 'Session closed before the user responded.',
          toolUseID: pending.toolUseID,
        });
      }
      input.end();
      q.close();
    },
  };
}
