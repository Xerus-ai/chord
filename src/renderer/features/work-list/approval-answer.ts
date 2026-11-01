import type { WorkItemCapabilities } from './work-item-access';

/**
 * Whether the viewer can answer the agent's permission and plan requests now,
 * and if not, why. The two reasons must not share copy: under an owner-only
 * policy the agent really is waiting on the owner, while a room that is
 * mid-reconnect takes this viewer's answer again in a second.
 */
export type ApprovalAnswer = 'answer' | 'owner_only' | 'reconnecting';

export function approvalAnswerOf(
  approvals: WorkItemCapabilities['approvals'],
  connected: boolean
): ApprovalAnswer {
  if (approvals === 'none') throw new Error('A viewer without approvals is shown no requests');
  if (approvals === 'owner_only') return 'owner_only';
  return connected ? 'answer' : 'reconnecting';
}

/** What a card says in place of its buttons when the viewer cannot answer. */
export const APPROVAL_NOTICE: Record<Exclude<ApprovalAnswer, 'answer'>, string> = {
  owner_only: 'Waiting on the owner to approve — only they can answer for this session.',
  reconnecting: 'Reconnecting to the session — you can answer again once you are back.',
};
