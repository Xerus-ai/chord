import { permissionPublicationService } from '@main/core/commands/permission-publication-service';
import { getActiveSessions } from '@main/core/work-items/active-sessions';
import { getAcpConnection } from './acp-session-store';

export type RespondToPermissionOutcome =
  | { ok: true }
  | { ok: false; reason: 'no_session' }
  | { ok: false; reason: 'failed'; message: string };

/**
 * The single answer path for a pending permission request, whoever answered
 * (design §4): the owner's click (acp/controller.ts RPC) and a teammate's
 * delivered permission_response command (command-inbox-service) both land
 * here, so the local-resolution tap fires identically for both — the stream
 * item flips to resolved (owner UI card clears) and the publication service
 * enqueues the cloud retraction (participant buttons clear via broadcast).
 * resolvedBy is the answering cloud user id for the command path, null for
 * the owner app.
 */
export async function respondToWorkItemPermission(
  workItemId: string,
  requestId: string,
  optionId: string,
  resolvedBy: string | null
): Promise<RespondToPermissionOutcome> {
  const sessions = getActiveSessions(workItemId);

  // Structured chat sessions (Claude canUseTool, Codex approval requests)
  // park permission prompts in-process; the owner is the one that knows this
  // requestId.
  for (const session of sessions) {
    if (session.chatHandle?.respondToPermission(requestId, optionId)) {
      completeResolution(session.bridge, workItemId, requestId, optionId, resolvedBy);
      return { ok: true };
    }
  }

  for (const session of sessions) {
    if (session.mode !== 'acp') continue;
    const connection = getAcpConnection(session.sessionId);
    if (!connection) continue;
    try {
      await connection.respondToPermission(requestId, optionId);
    } catch (e) {
      return { ok: false, reason: 'failed', message: String((e as Error)?.message || e) };
    }
    completeResolution(session.bridge, workItemId, requestId, optionId, resolvedBy);
    return { ok: true };
  }

  return { ok: false, reason: 'no_session' };
}

function completeResolution(
  bridge: { resolvePermissionItem: (workItemId: string, requestId: string) => void } | undefined,
  workItemId: string,
  requestId: string,
  optionId: string,
  resolvedBy: string | null
): void {
  bridge?.resolvePermissionItem(workItemId, requestId);
  permissionPublicationService.resolve(workItemId, requestId, optionId, resolvedBy);
}
