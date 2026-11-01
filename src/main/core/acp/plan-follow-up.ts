import type { ActiveSession } from '@main/core/work-items/active-sessions';

export type PlanAction = 'approve' | 'reject' | 'adjust';

/**
 * The live session that presented a plan — the one the plan ledger recorded
 * when the card was published. Only it may hear the decision: a work item can
 * run several chat sessions, and a sibling told "Plan approved" would act on
 * a plan it never made. Sessions that cannot answer a plan (PTY) never own one.
 */
export function findPlanOwner(
  sessions: readonly ActiveSession[],
  ownerSessionId: string | null
): ActiveSession | undefined {
  if (ownerSessionId === null) return undefined;
  return sessions.find(
    (s) => s.sessionId === ownerSessionId && (s.mode === 'acp' || s.chatHandle !== undefined)
  );
}

/**
 * The decision as a prompt, for a session with no parked plan call to settle
 * (ACP and Codex, whose plan ends the turn, or a Claude query restarted since
 * the card was published).
 */
export function planFollowUpPrompt(action: PlanAction, feedback?: string): string {
  if (action === 'approve') {
    return feedback
      ? `Plan approved with feedback: ${feedback}. Proceed with implementation.`
      : 'Plan approved. Proceed with implementation.';
  }
  if (action === 'adjust' && feedback) {
    return `The plan needs adjustments before approval: ${feedback}. Revise the plan and present it again.`;
  }
  return 'Plan rejected. Please propose an alternative approach.';
}
