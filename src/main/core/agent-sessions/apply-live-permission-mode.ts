import { resolvePermissionMode } from '@shared/agent-control-catalog';
import { requireAcpControls } from '@main/core/acp/acp-session-store';
import { getAgentControlCatalog } from '@main/core/agent-catalog/catalog-service';
import { getActiveSessions, type ActiveSession } from '@main/core/work-items/active-sessions';
import { withSavedDefaultMode } from './default-permission-mode';
import type { ChatPermissionMode } from './permission-mode-store';

/** A structured session's pick, resolved against its catalog for its current model. */
async function applyToChatHandle(session: ActiveSession, mode: ChatPermissionMode): Promise<void> {
  if (!session.chatHandle || !session.providerId) return;
  const catalog = await getAgentControlCatalog(session.providerId, session.sessionId);
  const pick = await withSavedDefaultMode(mode, session.providerId);
  const resolved = resolvePermissionMode(catalog, session.launch?.model ?? null, pick);
  if (resolved) await session.chatHandle.setPermissionMode(resolved.id);
}

/**
 * Switches the live chat sessions a mode pick targets — one session, or
 * every chat session of the work item: a structured session's mode (Claude's
 * permission mode; Codex reads it as each turn starts), an ACP agent's
 * session mode. No pick means the agent's saved default; each resolves the
 * pick against its own catalog, so a mode one agent lacks puts it in its
 * catalog default. PTY sessions have no live switch.
 */
export async function applyLivePermissionMode(
  workItemId: string,
  mode: ChatPermissionMode,
  sessionId: string | undefined
): Promise<void> {
  const live = getActiveSessions(workItemId).filter(
    (s) => s.kind === 'chat' && (sessionId === undefined || s.sessionId === sessionId)
  );
  await Promise.all(
    live.map(async (s) => {
      try {
        if (s.chatHandle) {
          await applyToChatHandle(s, mode);
        } else if (s.mode === 'acp' && s.providerId) {
          const pick = await withSavedDefaultMode(mode, s.providerId);
          await requireAcpControls(s.sessionId).applyPermissionMode(pick);
        }
      } catch (e) {
        throw new Error(`Failed to switch the live session's permission mode: ${String(e)}`);
      }
    })
  );
}
