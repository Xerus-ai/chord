import { useMemo } from 'react';
import { approvalAnswerOf } from '@renderer/features/work-list/approval-answer';
import { PermissionCard } from '@renderer/features/work-list/permission-card';
import { PlanCard } from '@renderer/features/work-list/plan-card';
import {
  useRetainedPanelActive,
  useRetainedPanelFocused,
} from '@renderer/features/work-list/retained-panel';
import type { WorkItemCapabilities } from '@renderer/features/work-list/work-item-access';
import { cloudApi } from '@renderer/lib/cloud-api';
import { permissionResponseKind, selectThreadRequests } from './cloud-approvals';
import { useCloudChatContext } from './cloud-chat-context';

/**
 * What the agent is blocked on, in a teammate's chat: the owner's cards, with
 * answers posted as commands (`permission_response`, `plan_response`) that the
 * owner's device delivers through the same path as the owner's own click.
 * Each chat shows its own session's requests (`selectThreadRequests`); a
 * request from no session shows in the focused chat. A card clears when its
 * request resolves (the room broadcast), however it was answered.
 */
export function CloudApprovalCards({
  sessionId,
  agentName,
  approvals,
  connected,
}: {
  sessionId: string | null;
  agentName: string;
  approvals: WorkItemCapabilities['approvals'];
  /** The room is joined; answers post over the command channel. */
  connected: boolean;
}) {
  const { permissionRequests, planRequests } = useCloudChatContext();
  const inFocusedPane = useRetainedPanelFocused();
  const shown = useRetainedPanelActive();
  const focused = inFocusedPane && shown;
  const permissions = useMemo(
    () => selectThreadRequests(permissionRequests, { sessionId, focused }),
    [permissionRequests, sessionId, focused]
  );
  const plans = useMemo(
    () => selectThreadRequests(planRequests, { sessionId, focused }),
    [planRequests, sessionId, focused]
  );

  if (permissions.length === 0 && plans.length === 0) return null;
  const answer = approvalAnswerOf(approvals, connected);

  return (
    <div className="flex shrink-0 flex-col gap-3 border-t border-border-subtle bg-surface px-5 py-3">
      {plans.map((request) => (
        <PlanCard
          key={request.request_id}
          title={request.title}
          overview={request.overview}
          steps={request.steps}
          status="pending"
          answer={answer}
          onApprove={() => answerPlan(request.work_item_id, request.request_id, 'approve')}
          onReject={() => answerPlan(request.work_item_id, request.request_id, 'reject')}
        />
      ))}
      {permissions.map((request) => (
        <PermissionCard
          key={request.request_id}
          agentName={agentName}
          toolName={request.tool_name}
          command={typeof request.input.command === 'string' ? request.input.command : undefined}
          // The wire carries a kind per answer; an option it cannot carry is not offered.
          options={request.options.filter((option) => permissionResponseKind(option) !== null)}
          answer={answer}
          onAnswer={(option) => answerPermission(request.work_item_id, request.request_id, option)}
        />
      ))}
    </div>
  );
}

async function answerPermission(
  workItemId: string,
  requestId: string,
  option: Parameters<typeof permissionResponseKind>[0]
): Promise<void> {
  const kind = permissionResponseKind(option);
  if (!kind) throw new Error(`The option "${option.name}" cannot be sent as an answer`);
  await cloudApi.postCommand(workItemId, {
    kind: 'permission_response',
    payload: { request_id: requestId, option_id: kind },
  });
}

async function answerPlan(
  workItemId: string,
  requestId: string,
  action: 'approve' | 'reject'
): Promise<void> {
  await cloudApi.postCommand(workItemId, {
    kind: 'plan_response',
    payload: { request_id: requestId, action },
  });
}
