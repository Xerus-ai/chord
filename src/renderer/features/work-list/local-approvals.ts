import { rpc } from '@renderer/lib/ipc';

/**
 * The owner answers the agent's permission request on this machine, through
 * ACP. Throws with the reason to show; the agent is then still blocked on the
 * request, so its card must stay live rather than be dismissed.
 */
export async function answerLocalPermission(
  workItemId: string,
  requestId: string,
  optionId: string
): Promise<void> {
  const result = await rpc.acp.respondToPermission({ workItemId, requestId, optionId });
  if (result.success) return;
  throw new Error(
    result.error.type === 'no_session'
      ? 'The agent session is no longer running, so this request cannot be answered.'
      : (result.error.message ?? 'Could not send your response. Try again.')
  );
}
