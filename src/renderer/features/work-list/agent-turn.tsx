import React, { useCallback, useMemo, useState } from 'react';
import type { AgentTurn as AgentTurnData } from '@shared/stream-items';
import { ArtifactDriftNotice } from '@renderer/features/artifacts/artifact-drift-notice';
import { rpc } from '@renderer/lib/ipc';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { PlanCard } from './plan-card';
import { QuestionSummary } from './question-summary';
import { SubagentView } from './subagent-view';
import { TaskListView } from './task-list-view';
import { ThinkingLabel } from './thinking-label';
import { ToolGroupStrip } from './tool-group-strip';
import type { OpenArtifactHandler } from './turn-artifact-chips';
import {
  collectUnpublishedDocuments,
  describeArtifactPath,
  partitionTurnItems,
} from './turn-artifacts';
import { TurnFooter } from './turn-footer';
import type { TurnHistoryAction } from './turn-history-actions';
import { UnpublishedDocumentChips } from './unpublished-document-chips';

interface AgentTurnProps {
  turn: AgentTurnData;
  workItemId: string;
  /** Root the created-file chips show paths relative to; null when unknown (participants). */
  workspaceRoot: string | null;
  onOpenArtifact?: OpenArtifactHandler;
  /** Reset and Fork for this turn — owner-only, absent in participant view. */
  history?: TurnHistoryAction;
}

function AgentTurnViewComponent({
  turn,
  workItemId,
  workspaceRoot,
  onOpenArtifact,
  history,
}: AgentTurnProps) {
  const { body, artifacts } = useMemo(() => partitionTurnItems(turn.items), [turn.items]);
  const unpublishedDocuments = useMemo(() => collectUnpublishedDocuments(turn.items), [turn.items]);
  const time = new Date(turn.timestamp * 1000);
  const timeStr = time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isStreaming = turn.status === 'streaming';

  // Plans whose session turned out to be gone when we tried to answer them.
  // The card degrades to read-only 'expired' instead of keeping live buttons
  // that can never deliver (same fallback history-plan-card.tsx has).
  const [expiredPlanIds, setExpiredPlanIds] = useState<ReadonlySet<string>>(new Set());

  const handlePlanResponse = useCallback(
    async (
      planItemId: string,
      artifactId: string,
      action: 'approve' | 'reject' | 'adjust',
      feedback?: string
    ) => {
      const result = await rpc.acp.respondToPlan({
        workItemId,
        artifactId,
        planItemId,
        action,
        feedback,
      });
      if (!result.success) {
        if (result.error?.type === 'no_session') {
          setExpiredPlanIds((prev) => new Set(prev).add(planItemId));
          throw new Error('The session that requested this plan has ended');
        }
        throw new Error(result.error?.type ?? 'failed');
      }
    },
    [workItemId]
  );

  return (
    // Flush left with no avatar or byline, like the persisted agent row
    // (chat-message-row.tsx): the agent narrates the
    // surface, so its name on every turn is repetition. The name and start
    // time stay on hover.
    <div
      className="group/turn flex max-w-[var(--max-content-width)] flex-col gap-1"
      title={`${turn.agentName} · ${timeStr}`}
    >
      <div>
        <div className="space-y-0">
          {body.map((item) => {
            switch (item.kind) {
              case 'thinking': {
                // A thinking item records only when it started; the sole real
                // end timestamp is the turn's completion. Measuring against
                // turn.timestamp (the turn's START) produced a negative span
                // that clamped to "Thought for 1s" on every live turn, so the
                // duration is shown only when it is actually measurable.
                const elapsedMs =
                  item.status === 'ready' && turn.completedAt != null
                    ? turn.completedAt - item.startedAt
                    : null;
                const dur =
                  elapsedMs != null && elapsedMs >= 1000 ? Math.round(elapsedMs / 1000) : undefined;
                return (
                  <ThinkingLabel
                    key={item.id}
                    text={item.text}
                    status={item.status}
                    durationSec={dur}
                  />
                );
              }
              case 'text':
                // One renderer while streaming and after: the
                // stream as markdown live. Swapping a plain-text stand-in for
                // markdown at completion made every list, heading and code
                // block jump into shape the moment the turn ended.
                return (
                  <MarkdownRenderer
                    key={item.id}
                    content={item.text}
                    variant="full"
                    className="mt-1 text-content tracking-body text-text"
                  />
                );
              case 'tool_group':
                return <ToolGroupStrip key={item.id} tools={item.tools} />;
              case 'permission':
                // Pending permissions render once, pinned above the composer
                // (room-panel.tsx, session-panel.tsx) — same as the persisted-history path
                // (chat-message-row.tsx), which renders null for this kind.
                return null;
              case 'question':
                // Pending: pinned above the composer (session-panel.tsx).
                return item.status === 'pending' ? null : (
                  <QuestionSummary key={item.id} item={item} />
                );
              case 'task_list':
                return (
                  <TaskListView
                    key={item.id}
                    title={item.title}
                    entries={item.entries}
                    completedCount={item.completedCount}
                    totalCount={item.totalCount}
                  />
                );
              case 'subagent':
                return <SubagentView key={item.id} agents={item.agents} workItemId={workItemId} />;
              case 'file_changes':
                // Rendered by TurnFooter as the collapsed changes summary.
                return null;
              case 'unpublished_documents':
                // Rendered by TurnFooter as "Add to artifacts" chips.
                return null;
              case 'plan_approval':
                return (
                  <PlanCard
                    key={item.id}
                    artifactId={item.artifactId}
                    title={item.title}
                    overview={item.overview}
                    steps={item.steps}
                    status={expiredPlanIds.has(item.id) ? 'expired' : item.status}
                    rationale={item.rationale}
                    planMarkdown={item.planMarkdown}
                    onApprove={() => handlePlanResponse(item.id, item.artifactId, 'approve')}
                    onReject={() => handlePlanResponse(item.id, item.artifactId, 'reject')}
                    onAdjust={(feedback) =>
                      handlePlanResponse(item.id, item.artifactId, 'adjust', feedback)
                    }
                    onOpenArtifact={(id, t) => onOpenArtifact?.(id, t)}
                  />
                );
              case 'error':
                return (
                  <div
                    key={item.id}
                    className="mt-2 rounded-[var(--radius-sm)] border border-border px-3 py-2 text-tiny tracking-tiny text-status-err"
                  >
                    {item.message}
                  </div>
                );
              default:
                return null;
            }
          })}
          {isStreaming && (
            <div className="mt-2 flex items-center">
              <span className="thinking-asterisk">&#10033;</span>
            </div>
          )}
          <TurnFooter
            turn={turn}
            artifacts={artifacts}
            workItemId={workItemId}
            workspaceRoot={workspaceRoot}
            onOpenArtifact={onOpenArtifact}
            history={history}
            driftNotices={
              // Owner view only, like the chips below: drift is measured on this machine.
              workspaceRoot
                ? artifacts.map((artifact) => (
                    <ArtifactDriftNotice
                      key={artifact.artifactId}
                      workItemId={workItemId}
                      artifactId={artifact.artifactId}
                      fileName={describeArtifactPath(artifact.filePath, workspaceRoot).fileName}
                      layout="inline"
                    />
                  ))
                : undefined
            }
            documentChips={
              // Owner view only: the participant view has no workspace, and no files to add.
              workspaceRoot && unpublishedDocuments.length > 0 ? (
                <UnpublishedDocumentChips
                  documents={unpublishedDocuments}
                  workItemId={workItemId}
                  workspaceRoot={workspaceRoot}
                  onOpenArtifact={onOpenArtifact}
                />
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

export const AgentTurnView = React.memo(AgentTurnViewComponent);
