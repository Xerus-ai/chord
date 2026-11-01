import type { AgentQuestionAnswers } from '@shared/agent-questions';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { updateArtifactStatus } from '@main/core/artifacts/updateArtifactStatus';
import { getActiveSessions } from '@main/core/work-items/active-sessions';
import { getAcpConnection } from './acp-session-store';
import { respondToWorkItemPermission } from './respond-to-permission';
import { respondToWorkItemPlan } from './respond-to-plan';
import { respondToWorkItemQuestion } from './respond-to-question';

function findAcpConnectionForWorkItem(workItemId: string) {
  const sessions = getActiveSessions(workItemId);
  for (const s of sessions) {
    if (s.mode === 'acp') {
      const connection = getAcpConnection(s.sessionId);
      if (connection) return connection;
    }
  }
  return undefined;
}

export const acpController = createRPCController({
  // The owner-click half of the shared answer path (respond-to-permission.ts)
  // — the same fan a delivered permission_response command uses, so the
  // local-resolution tap (stream item + cloud retraction) fires either way.
  respondToPermission: async (args: {
    workItemId: string;
    requestId: string;
    optionId: string;
  }) => {
    const outcome = await respondToWorkItemPermission(
      args.workItemId,
      args.requestId,
      args.optionId,
      null
    );
    if (outcome.ok) return ok();
    if (outcome.reason === 'no_session') return err({ type: 'no_session' as const });
    return err({ type: 'failed' as const, message: outcome.message });
  },

  /** The question card's answer, or null when the user dismissed it. */
  respondToQuestion: (args: {
    workItemId: string;
    requestId: string;
    answers: AgentQuestionAnswers | null;
  }) => {
    if (respondToWorkItemQuestion(args.workItemId, args.requestId, args.answers)) return ok();
    return err({ type: 'no_session' as const });
  },

  cancelSession: async (workItemId: string) => {
    const connection = findAcpConnectionForWorkItem(workItemId);
    if (!connection) return err({ type: 'no_session' as const });

    try {
      await connection.cancel();
      return ok();
    } catch (e) {
      return err({ type: 'failed' as const, message: String((e as Error)?.message || e) });
    }
  },

  respondToPlan: async (args: {
    workItemId: string;
    artifactId: string;
    planItemId: string;
    action: 'approve' | 'reject' | 'adjust';
    feedback?: string;
  }) => {
    const outcome = await respondToWorkItemPlan(
      args.workItemId,
      args.planItemId,
      args.action,
      args.feedback
    );
    if (!outcome.ok) {
      if (outcome.reason === 'no_session') return err({ type: 'no_session' as const });
      return err({ type: 'failed' as const, message: outcome.message });
    }

    const newStatus = args.action === 'approve' ? ('approved' as const) : ('draft' as const);
    if (args.artifactId) {
      await updateArtifactStatus(args.artifactId, newStatus);
    }

    return ok();
  },

  getSessionStatus: (workItemId: string) => {
    const connection = findAcpConnectionForWorkItem(workItemId);
    return ok({ active: connection?.isAlive() ?? false });
  },
});
