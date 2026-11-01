import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import type { StreamItem } from '@shared/stream-items';
import { resolveProfileDir } from '@main/app/profile';
import { createArtifact } from '@main/core/artifacts/createArtifact';
import { pushArtifactContentToRenderer } from '@main/core/artifacts/push-to-yjs';
import { planPublicationService } from '@main/core/commands/plan-publication-service';
import { log } from '@main/lib/logger';
import { extractPlanOverviewFromMarkdown, extractPlanTitleFromMarkdown } from './plan-content';
import { generatePlanMdx } from './plan-mdx-generator';
import type { TurnItemStream } from './stream-turn-items';
import { upsertPlanTaskList } from './synthesize-task-list';

export type PlanMode = 'inactive' | 'awaiting_approval' | 'approved';

type PlanApprovalItem = StreamItem & { kind: 'plan_approval' };

const isPlanApproval = (item: StreamItem): item is PlanApprovalItem =>
  item.kind === 'plan_approval';

interface PlanDraft {
  title: string;
  overview: string;
  entries: Array<{ text: string; completed: boolean }>;
  planMarkdown?: string;
  sessionRequestId?: string;
  artifactContent: string;
  artifactType: 'markdown' | 'mdx';
}

/**
 * Owns the plan card's lifecycle: presenting a plan for approval, settling it
 * when anyone answers, and deciding whether a later `plan` update is a new
 * proposal or progress on one already approved.
 */
export class PlanApprovalTracker {
  private mode: PlanMode = 'inactive';
  /** Armed when a parked ExitPlanMode is approved: its tool RESULT echoes the
      same plan back and must not render a second copy. Cleared on turn end. */
  private suppressNextPlanEcho = false;
  private onModeChange?: (mode: PlanMode) => void;

  constructor(
    private stream: TurnItemStream,
    private readSessionId: () => string | null
  ) {}

  setOnModeChange(cb: (mode: PlanMode) => void): void {
    this.onModeChange = cb;
  }

  clearPlanEchoSuppression(): void {
    this.suppressNextPlanEcho = false;
  }

  /**
   * A parked ExitPlanMode call (claude-sdk transport): the agent is blocked
   * inside the tool until respondToWorkItemPlan settles the parked
   * PermissionResult via `sessionRequestId`. The raw markdown from the tool
   * input is the plan: the card renders it verbatim.
   */
  requestApproval(workItemId: string, event: AgentOutputEvent & { type: 'plan_request' }): void {
    const entries = event.entries.map((e) => ({
      text: e.text,
      completed: e.status === 'completed',
    }));
    const title = extractPlanTitleFromMarkdown(event.plan) ?? this.deriveTitle(entries);
    const overview =
      extractPlanOverviewFromMarkdown(event.plan) ??
      entries
        .slice(0, 2)
        .map((e) => e.text)
        .join('. ');

    this.presentPlan(workItemId, {
      title,
      overview,
      entries,
      planMarkdown: event.plan,
      sessionRequestId: event.requestId,
      artifactContent: event.plan,
      artifactType: 'markdown',
    });
  }

  /** Structured plan entries without markdown — the ACP transport's native
      `plan` update, and result-derived plans on older flows. */
  handlePlanUpdate(workItemId: string, event: AgentOutputEvent & { type: 'plan' }): void {
    // The ExitPlanMode RESULT re-carries the plan the user just approved.
    // Re-ingesting it rendered the same plan a second time as a stillborn
    // task list ("Plan 0 of N" that never progresses) right under the
    // approved card — one plan, one representation. Real progress lists come
    // from the agent's own todo updates, not from this echo.
    if (this.suppressNextPlanEcho) {
      this.suppressNextPlanEcho = false;
      return;
    }

    if (this.mode === 'approved') {
      this.stream.finalizeThoughts();
      upsertPlanTaskList(
        this.stream,
        workItemId,
        event.entries.map((e) => ({
          text: e.text,
          completed: e.status === 'completed',
          status: e.status,
        }))
      );
      return;
    }

    const entries = event.entries.map((e) => ({
      text: e.text,
      completed: e.status === 'completed',
    }));
    const title = this.deriveTitle(entries);
    const overview = entries
      .slice(0, 2)
      .map((e) => e.text)
      .join('. ');

    this.presentPlan(workItemId, {
      title,
      overview,
      entries,
      artifactContent: generatePlanMdx(entries, title),
      artifactType: 'mdx',
    });
  }

  /** The parked canUseTool requestId behind a plan card, when the claude-sdk
      transport parked one — what respondToWorkItemPlan settles the tool with. */
  getSessionRequestId(planItemId: string): string | null {
    for (const item of this.stream.listItems()) {
      if (isPlanApproval(item) && item.id === planItemId) {
        return item.sessionRequestId ?? null;
      }
    }
    return null;
  }

  resolveApproval(
    workItemId: string,
    planItemId: string,
    action: 'approve' | 'reject' | 'adjust'
  ): void {
    for (const item of this.stream.listItems()) {
      if (!isPlanApproval(item) || item.id !== planItemId) continue;

      item.status =
        action === 'approve' ? 'approved' : action === 'adjust' ? 'adjusted' : 'rejected';
      this.stream.update(workItemId, item);
      if (action === 'approve') {
        // Parked claude-sdk plans (sessionRequestId) answer through the
        // tool call, whose result will echo the plan back — swallow it.
        if (item.sessionRequestId) this.suppressNextPlanEcho = true;
        this.setMode('approved');
      } else {
        this.setMode('inactive');
      }
      return;
    }
  }

  /**
   * A plan nobody answered before its session ended can never be answered —
   * the parked ExitPlanMode call died with the process. Settling it to
   * 'expired' before the turn is persisted keeps the transcript honest;
   * leaving it 'pending' would render live Approve/Reject buttons forever.
   * Only session-death paths call this: a turn that completes normally with
   * a pending plan (the ACP transport) stays answerable via sendInput.
   */
  expirePendingApprovals(workItemId: string): void {
    for (const item of this.stream.listItems()) {
      if (isPlanApproval(item) && item.status === 'pending') {
        item.status = 'expired';
        this.stream.update(workItemId, item);
      }
    }
  }

  private presentPlan(workItemId: string, plan: PlanDraft): void {
    this.setMode('awaiting_approval');
    this.stream.finalizeThoughts();

    const artifactId = this.writePlanArtifact(workItemId, plan);

    // Only a still-pending card is updated in place (a revised plan streaming
    // in before anyone answered). A card settled as 'adjusted' or 'rejected'
    // stays in the transcript; the agent's revision gets its own card.
    const existing = this.stream.findItem(
      (i): i is PlanApprovalItem => isPlanApproval(i) && i.status === 'pending'
    );
    if (existing) {
      existing.steps = plan.entries;
      existing.title = plan.title;
      existing.overview = plan.overview;
      if (plan.planMarkdown) existing.planMarkdown = plan.planMarkdown;
      if (plan.sessionRequestId) existing.sessionRequestId = plan.sessionRequestId;
      if (artifactId) existing.artifactId = artifactId;
      this.stream.update(workItemId, existing);
      return;
    }

    const item: StreamItem = {
      kind: 'plan_approval',
      id: randomUUID(),
      artifactId: artifactId ?? '',
      title: plan.title,
      overview: plan.overview,
      steps: plan.entries,
      status: 'pending',
      planMarkdown: plan.planMarkdown,
      sessionRequestId: plan.sessionRequestId,
    };
    this.stream.add(workItemId, item);

    planPublicationService.publish({
      workItemId,
      sessionId: this.readSessionId(),
      requestId: item.id,
      title: plan.title,
      overview: plan.overview,
      steps: plan.entries,
    });
  }

  /**
   * The plan's durable record — what "Open plan" and artifact comments hang
   * off. It lives in the app profile, NOT the user's repo: the plan is a
   * conversation object, and writing `.chord/plans/` into the workspace
   * left untracked litter in every repo an agent planned in. No artifact
   * card is emitted for it either — the plan card IS the plan; this row is
   * just its openable form.
   */
  private writePlanArtifact(workItemId: string, plan: PlanDraft): string | undefined {
    try {
      const planDir = join(resolveProfileDir(), 'plans', workItemId);
      mkdirSync(planDir, { recursive: true });

      const extension = plan.artifactType === 'markdown' ? 'md' : 'mdx';
      const filePath = join(planDir, `plan-${this.stream.turnIdentifier}.${extension}`);
      writeFileSync(filePath, plan.artifactContent, 'utf-8');

      const result = createArtifact({
        workItemId,
        filePath,
        name: plan.title,
        type: plan.artifactType,
        content: plan.artifactContent,
      });

      void pushArtifactContentToRenderer(workItemId, result.id, filePath);
      return result.id;
    } catch (e) {
      log.warn('PlanApprovalTracker: failed to create plan artifact', { error: String(e) });
      return undefined;
    }
  }

  /** The line the agent wrote just before the plan is its real headline. */
  private deriveTitle(entries: Array<{ text: string }>): string {
    const lastText = this.stream.findLastItem(
      (i): i is StreamItem & { kind: 'text' } => i.kind === 'text'
    );
    if (lastText) {
      const lines = lastText.text.trim().split('\n');
      const lastLine = lines[lines.length - 1].trim();
      if (lastLine.length > 5 && lastLine.length < 120) {
        return lastLine.replace(/[:#*_`]/g, '').trim();
      }
    }
    return entries[0]?.text.slice(0, 80) || 'Implementation Plan';
  }

  private setMode(mode: PlanMode): void {
    this.mode = mode;
    this.onModeChange?.(mode);
  }
}
