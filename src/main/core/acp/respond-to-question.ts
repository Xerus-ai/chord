import type { AgentQuestionAnswers } from '@shared/agent-questions';
import { getActiveSessions } from '@main/core/work-items/active-sessions';

/**
 * The answer path for a pending question card: the session that parked the
 * question answers its agent, then the card settles. Questions are the
 * owner's alone — unlike permissions they are not published to the cloud, so
 * a secret answer never leaves this machine. `answers` null dismisses.
 */
export function respondToWorkItemQuestion(
  workItemId: string,
  requestId: string,
  answers: AgentQuestionAnswers | null
): boolean {
  for (const session of getActiveSessions(workItemId)) {
    if (session.chatHandle?.respondToQuestion(requestId, answers)) {
      session.bridge?.resolveQuestionItem(workItemId, requestId, answers);
      return true;
    }
  }
  return false;
}
