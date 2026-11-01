import { useCallback, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import type { PlanEntryData } from './chat-types';
import { PlanCard } from './plan-card';

interface HistoryPlanCardProps {
  workItemId?: string;
  /** Stream item id the agent is blocked on; absent on rows that predate it. */
  planItemId?: string;
  artifactId: string;
  title: string;
  overview: string;
  steps: PlanEntryData[];
  status: 'pending' | 'approved' | 'rejected' | 'adjusted';
  rationale?: string;
  planMarkdown?: string;
  onOpenArtifact?: (artifactId: string, title: string) => void;
}

/**
 * A plan-approval card rebuilt from persisted chat history.
 *
 * The live path (agent-turn.tsx) answers plans through `rpc.acp.respondToPlan`;
 * a reloaded card must reach the same RPC or its buttons are decoration. When
 * the row carries no plan item id, or the session that asked is gone, the card
 * renders read-only instead of offering an approval that cannot be delivered.
 */
export function HistoryPlanCard({
  workItemId,
  planItemId,
  artifactId,
  title,
  overview,
  steps,
  status,
  rationale,
  planMarkdown,
  onOpenArtifact,
}: HistoryPlanCardProps) {
  const [answeredStatus, setAnsweredStatus] = useState<'approved' | 'rejected' | 'adjusted' | null>(
    null
  );
  const [expired, setExpired] = useState(false);

  const respond = useCallback(
    async (action: 'approve' | 'reject' | 'adjust', feedback?: string) => {
      if (!workItemId || !planItemId) throw new Error('This plan can no longer be answered');
      const result = await rpc.acp.respondToPlan({
        workItemId,
        artifactId,
        planItemId,
        action,
        feedback,
      });
      if (!result.success) {
        if (result.error.type === 'no_session') {
          setExpired(true);
          throw new Error('The session that requested this plan has ended');
        }
        throw new Error(result.error.message ?? result.error.type);
      }
      setAnsweredStatus(
        action === 'approve' ? 'approved' : action === 'adjust' ? 'adjusted' : 'rejected'
      );
    },
    [workItemId, planItemId, artifactId]
  );

  const answerable = Boolean(workItemId && planItemId) && !expired;
  const effectiveStatus =
    answeredStatus ?? (status === 'pending' && !answerable ? 'expired' : status);

  return (
    <PlanCard
      artifactId={artifactId}
      title={title}
      overview={overview}
      steps={steps}
      status={effectiveStatus}
      rationale={rationale}
      planMarkdown={planMarkdown}
      onApprove={() => respond('approve')}
      onReject={() => respond('reject')}
      onAdjust={(feedback) => respond('adjust', feedback)}
      onOpenArtifact={(id, t) => onOpenArtifact?.(id, t)}
    />
  );
}
