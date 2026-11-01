import { useCallback, useState } from 'react';
import {
  describeRpcFailure,
  describeThrownFailure,
} from '@renderer/features/work-list/describe-action-failure';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

/**
 * Every "Fix with AI", "Resolve conflicts with AI" and "Add to chat" in the
 * rail goes through here. One abstraction, as the design requires: the
 * alternative is each panel inventing its own prompt shape, and the agent
 * receiving four different framings of the same request.
 *
 * A handoff is a structured request, not free prose — `subject` names the
 * thing, `detail` is the evidence pasted verbatim, and `instruction` is what
 * the agent should do with it. "Add to chat" is the same builder with no
 * instruction: context for the user's next message.
 */
export interface HandoffRequest {
  subject: string;
  detail: string;
  instruction?: string;
}

export function buildHandoffPrompt(request: HandoffRequest): string {
  const parts = [`## ${request.subject}`, request.detail.trim()];
  if (request.instruction) parts.push(request.instruction.trim());
  return parts.join('\n\n');
}

export interface HandoffTarget {
  workItemId: string;
  /** Omitted sends to the work item's own agent, as the Review chips do today. */
  sessionId?: string;
}

/**
 * Sends the built prompt to the agent and reports the outcome.
 *
 * The rail cannot put text into the composer without owning it, so a handoff
 * sends rather than drafts. `chat-input.tsx` has no shared draft store to
 * write into — adding one belongs with the composer, not here.
 */
export function useAgentHandoff(target: HandoffTarget) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handoff = useCallback(
    async (request: HandoffRequest) => {
      if (sending) return;
      setSending(true);
      setError(null);
      try {
        const result = await rpc.chatMessages.sendToAgent({
          workItemId: target.workItemId,
          sessionId: target.sessionId,
          content: buildHandoffPrompt(request),
          senderName: 'Chord',
        });
        if (!result.success) {
          setError(describeRpcFailure('Send to agent', result.error));
          return;
        }
        toast({ title: 'Sent to agent', description: request.subject });
      } catch (thrown) {
        setError(describeThrownFailure('Send to agent', thrown));
      } finally {
        setSending(false);
      }
    },
    [target.workItemId, target.sessionId, sending]
  );

  return { handoff, sending, error };
}
