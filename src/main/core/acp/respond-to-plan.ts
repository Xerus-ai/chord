import { applyLivePermissionMode } from '@main/core/agent-sessions/apply-live-permission-mode';
import { withSavedDefaultMode } from '@main/core/agent-sessions/default-permission-mode';
import {
  getPreviousChatPermissionMode,
  type ChatPermissionMode,
} from '@main/core/agent-sessions/permission-mode-store';
import { reportPermissionMode } from '@main/core/agent-sessions/report-permission-mode';
import { planPublicationService } from '@main/core/commands/plan-publication-service';
import { getActiveSessions } from '@main/core/work-items/active-sessions';
import { sendInput } from '@main/core/work-items/session-service';
import { findPlanOwner, planFollowUpPrompt, type PlanAction } from './plan-follow-up';

export type RespondToPlanOutcome =
  | { ok: true }
  | { ok: false; reason: 'no_session' }
  | { ok: false; reason: 'failed'; message: string };

export async function respondToWorkItemPlan(
  workItemId: string,
  planItemId: string,
  action: PlanAction,
  feedback?: string,
  resolvedBy?: string | null
): Promise<RespondToPlanOutcome> {
  const published = planPublicationService.getPublishedRequest(planItemId);
  if (!published) return { ok: false, reason: 'failed', message: 'Unknown plan' };
  const owner = findPlanOwner(getActiveSessions(workItemId), published.sessionId);
  if (!owner) return { ok: false, reason: 'no_session' };

  // Settle the plan atomically BEFORE any side effect. resolve() CASes the
  // ledger row on status='pending', so exactly one responder wins when the
  // owner's click and a participant's command race the same plan. The loser
  // returns here without injecting a second (possibly contradictory) message
  // into the agent or re-flipping the card — the permission path gets this
  // idempotency for free from respondToPermission's consumed-guard; plans need
  // it made explicit. The cloud wire has no 'adjust' resolution: an adjusted
  // plan is 'reject' on the wire (the agent revises and publishes a new one).
  const wireAction = action === 'approve' ? 'approve' : 'reject';
  if (!planPublicationService.resolve(workItemId, planItemId, wireAction, resolvedBy ?? null)) {
    return { ok: false, reason: 'failed', message: 'Plan already resolved' };
  }

  // An approved plan means the session leaves plan mode for the mode it was
  // in before (the agent's saved default when plan was its first pick, else
  // its catalog default) — recorded
  // for the composer's mode menu, so a later session restart doesn't
  // resurrect plan. Only the owner: its siblings stay as they are.
  let modeAfterPlan: ChatPermissionMode = null;
  if (action === 'approve') {
    if (!owner.providerId) throw new Error(`Plan owner ${owner.sessionId} has no agent`);
    modeAfterPlan = await withSavedDefaultMode(
      getPreviousChatPermissionMode(workItemId, owner.sessionId),
      owner.providerId
    );
    reportPermissionMode(workItemId, owner.sessionId, modeAfterPlan);
  }

  // Preferred: settle the parked ExitPlanMode call as a protocol reply —
  // approve lets the same turn continue (the CLI leaves plan mode itself and
  // reports the mode it moved to), adjust/reject keeps it in plan mode with
  // the feedback as the tool denial message. No injected prompt, so no
  // spurious extra turn after implementation.
  const requestId = owner.bridge?.getPlanSessionRequestId(planItemId);
  if (requestId && owner.chatHandle?.respondToPlan(requestId, action, feedback)) {
    owner.bridge?.resolvePlanApproval(workItemId, planItemId, action);
    return { ok: true };
  }

  // No parked call (ACP and Codex, whose plan ends the turn, or a claude-sdk
  // query restarted since the card was published): the decision is a prompt.
  // An approved plan is implemented outside plan mode, so the live agent is
  // switched out of it first — an agent still in its plan mode cannot edit.
  if (action === 'approve') {
    await applyLivePermissionMode(workItemId, modeAfterPlan, owner.sessionId);
  }
  if (sendInput(owner.sessionId, planFollowUpPrompt(action, feedback))) {
    owner.bridge?.resolvePlanApproval(workItemId, planItemId, action);
  }
  // Otherwise the owner died in the interim: the resolution stands — the
  // cloud row is retracted — there is just no agent left to hear the decision.
  return { ok: true };
}
