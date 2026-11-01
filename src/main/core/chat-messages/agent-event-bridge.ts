import { randomUUID } from 'node:crypto';
import type { AcpPermissionRequest, AcpSessionUpdate } from '@shared/acp-types';
import type { AgentQuestionAnswers } from '@shared/agent-questions';
import type { AgentOutputEvent, UsageInfo } from '@shared/events/agentOutputEvents';
import type { AgentTurn } from '@shared/stream-items';
import { convertPermissionRequest, convertSessionUpdate } from '@main/core/acp/acp-adapter';
import type { PublishArtifactResult } from '@main/core/agent-artifact-tools/publish-artifact';
import { captureTurnCheckpoint } from '@main/core/checkpoints/checkpoint-service';
import { permissionPublicationService } from '@main/core/commands/permission-publication-service';
import { scheduleWorktreeCloudSync } from '@main/core/worktrees/worktree-cloud-sync';
import {
  getPrimaryWorktreeRow,
  resolveSessionWorktreeRow,
} from '@main/core/worktrees/worktree-lookup';
import { log } from '@main/lib/logger';
import { TurnTextAppender } from './append-turn-text';
import { collectChangedFiles } from './collect-changed-files';
import { persistCompletedTurn, recordSessionTurnOutcome } from './persist-agent-turn';
import { TurnItemStream } from './stream-turn-items';
import { PlanApprovalTracker, type PlanMode } from './track-plan-approval';
import { QuestionTracker } from './track-questions';
import { appendToolCall, updateToolCall } from './track-tool-calls';
import { TurnArtifactTracker } from './track-turn-artifacts';

/**
 * Translates one agent session's output — ACP updates, SDK events, permission
 * and plan requests — into the work item's live turn, then persists that turn
 * when the session's turn ends. Every responsibility beyond the dispatch itself
 * lives in a collaborator: the stream, the artifact tracker, the plan tracker.
 */
export class AgentEventBridge {
  private stream = new TurnItemStream();
  private artifacts = new TurnArtifactTracker(this.stream, (workItemId) =>
    this.ensureTurnStarted(workItemId)
  );
  private plans = new PlanApprovalTracker(this.stream, () => this.sessionId);
  private questions = new QuestionTracker(this.stream);
  private text = new TurnTextAppender(this.stream);

  private turnStarted = false;
  private turnStartedAt: number | null = null;
  private lastUsage: { inputTokens?: number; outputTokens?: number; totalCostUsd?: number } = {};
  private cwd: string | null = null;
  private sessionId: string | null = null;

  /** `agentName` is the provider's display name (`getAgentDisplayName`). */
  constructor(private agentName: string) {}

  setOnPlanModeChange(cb: (mode: PlanMode) => void): void {
    this.plans.setOnModeChange(cb);
  }

  setSessionId(id: string): void {
    this.sessionId = id;
    this.stream.setSessionId(id);
  }

  startWatching(workItemId: string, cwd: string): void {
    this.cwd = cwd;
    this.artifacts.setSession(workItemId, cwd);
  }

  /** Mirrors "Let agents create artifacts" for this session's unpublished-document chips. */
  setUnpublishedDocumentChips(enabled: boolean): void {
    this.artifacts.setUnpublishedChipsEnabled(enabled);
  }

  /** The chord `publish_artifact` tool's success path. */
  recordPublishedArtifact(workItemId: string, result: PublishArtifactResult): void {
    this.artifacts.recordPublished(workItemId, result);
  }

  stopWatching(): void {
    // No-op: fs.watch disabled (see startWatching)
  }

  private ensureTurnStarted(workItemId: string): void {
    if (this.turnStarted) return;
    this.turnStarted = true;
    this.turnStartedAt = Date.now();
    this.stream.emitTurnStarted(workItemId, this.agentName, this.turnStartedAt);
  }

  handleAcpUpdate(workItemId: string, update: AcpSessionUpdate): void {
    const event = convertSessionUpdate(update);
    if (!event) return;

    this.ensureTurnStarted(workItemId);

    switch (event.type) {
      case 'reasoning':
        this.text.appendThought(workItemId, event.text);
        break;
      case 'text':
        this.text.appendText(workItemId, event.text);
        break;
      case 'text_block_start':
        this.text.openBlock();
        break;
      case 'tool_call':
        appendToolCall(this.stream, this.artifacts.writes, workItemId, event);
        break;
      case 'tool_call_update': {
        // An enrichment carries the tool's input, not a state change — letting
        // its 'in_progress' through would revive an already-settled call.
        const isEnrichment = event.rawInput && Object.keys(event.rawInput).length > 0;
        const effectiveStatus =
          isEnrichment && event.status === 'in_progress' ? undefined : event.status;
        updateToolCall(
          this.stream,
          this.artifacts.writes,
          workItemId,
          event.callId,
          effectiveStatus,
          event.rawInput,
          event.content
        );
        break;
      }
      case 'usage':
        this.recordUsage(event);
        break;
      case 'plan':
        this.plans.handlePlanUpdate(workItemId, event);
        break;
      case 'permission_request':
      case 'error':
      case 'config_update':
      case 'turn_started':
      case 'turn_completed':
        break;
    }
  }

  /** The token counts and cost the completed turn reports as its usage. */
  recordUsage(usage: UsageInfo): void {
    this.lastUsage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalCostUsd: usage.totalCostUsd,
    };
  }

  handlePermission(workItemId: string, request: AcpPermissionRequest): void {
    this.ensureTurnStarted(workItemId);

    const event = convertPermissionRequest(request);
    if (event.type !== 'permission_request') return;
    const options = (event.options ?? []).map(
      (o: { optionId: string; name: string; kind: string }) => ({
        optionId: o.optionId,
        name: o.name,
        kind: o.kind,
      })
    );
    this.stream.add(workItemId, {
      kind: 'permission',
      id: randomUUID(),
      requestId: event.requestId,
      name: event.name,
      title: event.title ?? event.name,
      command: event.input?.command as string | undefined,
      options,
    });

    // The publication tap (design §4): the same request that just rendered
    // for the owner is published to the cloud so participant views render
    // it too. Retraction fires from the shared answer path or session end.
    permissionPublicationService.publish({
      workItemId,
      sessionId: this.sessionId,
      requestId: event.requestId,
      toolName: event.name,
      input: event.input ?? {},
      options,
    });
  }

  /**
   * The answer path's tap (acp/respond-to-permission.ts): flips the pinned
   * permission card to resolved the moment the request is answered — by
   * ANYONE — instead of leaving live buttons until the turn completes.
   */
  resolvePermissionItem(workItemId: string, requestId: string): void {
    for (const item of this.stream.listItems()) {
      if (item.kind === 'permission' && item.requestId === requestId && !item.resolved) {
        item.resolved = true;
        this.stream.update(workItemId, item);
        return;
      }
    }
  }

  handleQuestionRequest(
    workItemId: string,
    event: AgentOutputEvent & { type: 'question_request' }
  ): void {
    this.ensureTurnStarted(workItemId);
    this.questions.request(workItemId, event.requestId, event.questions);
  }

  /** Settles the question card whoever answered; `answers` null = dismissed. */
  resolveQuestionItem(
    workItemId: string,
    requestId: string,
    answers: AgentQuestionAnswers | null
  ): void {
    this.questions.resolve(workItemId, requestId, answers);
  }

  handleFileWrite(reportedPath: string): void {
    this.artifacts.writes.recordWrite(reportedPath);
  }

  handlePlanRequest(workItemId: string, event: AgentOutputEvent & { type: 'plan_request' }): void {
    this.ensureTurnStarted(workItemId);

    // The agent's own draft file (e.g. ~/.claude/plans/*.md) is plan-mode
    // machinery, not a deliverable — it must never become an artifact card.
    if (event.planFilePath) this.artifacts.writes.suppress(event.planFilePath);

    this.plans.requestApproval(workItemId, event);
  }

  getPlanSessionRequestId(planItemId: string): string | null {
    return this.plans.getSessionRequestId(planItemId);
  }

  resolvePlanApproval(
    workItemId: string,
    planItemId: string,
    action: 'approve' | 'reject' | 'adjust'
  ): void {
    this.plans.resolveApproval(workItemId, planItemId, action);
  }

  handleError(workItemId: string, error: Error): void {
    this.stream.markErrored();
    this.stream.add(workItemId, { kind: 'error', id: randomUUID(), message: error.message });
  }

  // The single turn-completer for every session-end path (both claude-sdk and
  // ACP funnel their onExit here). A non-zero/abnormal exit strands any tool
  // still mid-flight and any thinking block still loading, so they are settled
  // to failed/ready before the turn is persisted — otherwise the resumed
  // transcript would render them spinning forever.
  handleExit(workItemId: string, code: number | null): void {
    if (code !== 0 && code !== null) {
      for (const item of this.stream.listItems()) {
        if (item.kind === 'tool_group') {
          for (const tool of item.tools) {
            if (tool.status === 'in_progress' || tool.status === 'pending') {
              tool.status = 'failed';
            }
          }
        }
        if (item.kind === 'thinking' && item.status === 'loading') {
          item.status = 'ready';
        }
      }
      this.handleError(workItemId, new Error(`Agent process exited with code ${code}`));
    }
    this.plans.expirePendingApprovals(workItemId);
    this.completeTurn(workItemId);
  }

  /** In-flight turn for late subscribers; it exists nowhere else until completeTurn persists it. */
  getLiveTurnSnapshot():
    | ({ turnId: string } & Pick<
        AgentTurn,
        'agentName' | 'items' | 'timestamp' | 'startedAt' | 'sessionId'
      >)
    | null {
    if (!this.turnStarted || this.stream.itemCount === 0) return null;
    return {
      turnId: this.stream.turnIdentifier,
      agentName: this.agentName,
      items: this.stream.cloneItems(),
      timestamp: Math.floor(Date.now() / 1000),
      startedAt: this.turnStartedAt ?? undefined,
      sessionId: this.sessionId ?? undefined,
    };
  }

  /**
   * Persist whatever streamed so far when the session is stopped mid-turn
   * (user stop, app quit). Without this the entire response vanishes on
   * relaunch — the chat shows the prompt with no reply.
   */
  flushPartialTurn(workItemId: string): void {
    if (!this.turnStarted || this.stream.itemCount === 0) return;
    // Both callers (stopSession, before-quit) are session-death paths.
    this.plans.expirePendingApprovals(workItemId);
    this.completeTurn(workItemId);
  }

  /** Whether a turn has started and not yet completed: Reset waits for it. */
  hasTurnInFlight(): boolean {
    return this.turnStarted;
  }

  /** `historyRef`: where the agent reported its conversation can be cut after this turn. */
  completeTurn(workItemId: string, opts: { historyRef?: string } = {}): void {
    this.stream.finalizeThoughts();
    this.emitFileChanges(workItemId);
    this.artifacts.completeTurn(workItemId);
    this.stream.flush();

    const completedAt = Date.now();
    const turnId = this.stream.turnIdentifier;
    if (this.stream.itemCount > 0) {
      const turn: AgentTurn = {
        id: turnId,
        workItemId,
        agentName: this.agentName,
        items: [...this.stream.listItems()],
        status: 'complete',
        timestamp: Math.floor(completedAt / 1000),
        startedAt: this.turnStartedAt ?? undefined,
        completedAt,
        // A turn that genuinely consumed 0 input tokens still has usage to
        // report — only an absent count means the agent never sent one.
        usage: this.lastUsage.inputTokens != null ? { ...this.lastUsage } : undefined,
        sessionId: this.sessionId ?? undefined,
        historyRef: opts.historyRef,
      };
      persistCompletedTurn(workItemId, turn, this.sessionId);
      recordSessionTurnOutcome(this.sessionId, this.stream.isErrored);
      // T0.8: a finished turn can flip the worktree's status bucket (e.g.
      // idle -> ready_to_review) — cheapest real bucket-change trigger, no
      // polling. Debounced and a no-op for non-shared items; see
      // worktree-cloud-sync.ts.
      scheduleWorktreeCloudSync(workItemId);

      // Fire-and-forget: a checkpoint failure must never block turn completion.
      // Resolved worktree lookups can throw synchronously (e.g. a session
      // pointing at a since-deleted worktree row), so the whole thing runs
      // inside the async wrapper rather than only guarding the awaited call.
      if (this.cwd) {
        void (async () => {
          const worktreeRow = this.sessionId
            ? resolveSessionWorktreeRow(this.sessionId)
            : getPrimaryWorktreeRow(workItemId);
          await captureTurnCheckpoint({
            workItemId,
            turnId,
            sessionId: this.sessionId,
            repoPath: worktreeRow.path,
            worktreeId: worktreeRow.id,
          });
        })().catch((error) => {
          log.warn('AgentEventBridge: turn checkpoint failed', {
            workItemId,
            turnId,
            error: String(error),
          });
        });
      }
    }

    this.stream.emitTurnCompleted(workItemId, completedAt);

    this.stream.startNextTurn();
    this.turnStarted = false;
    this.turnStartedAt = null;
    this.plans.clearPlanEchoSuppression();
  }

  private emitFileChanges(workItemId: string): void {
    const files = collectChangedFiles(this.stream.listItems(), this.cwd);
    if (files.length === 0) return;
    this.stream.add(workItemId, { kind: 'file_changes', id: randomUUID(), files });
  }
}
