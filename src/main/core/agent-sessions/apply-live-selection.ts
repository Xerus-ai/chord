import { eq } from 'drizzle-orm';
import { requireAcpControls } from '@main/core/acp/acp-session-store';
import { getAgentControlCatalog } from '@main/core/agent-catalog/catalog-service';
import { getActiveSession, setActiveSessionLaunch } from '@main/core/work-items/active-sessions';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { applyLivePermissionMode } from './apply-live-permission-mode';
import { getChatPermissionMode } from './permission-mode-store';
import { launchConfigChanged, resolveChatLaunchConfig } from './session-config-store';

/**
 * Applies a session tab's new model/effort/fast pick to its running agent, so
 * the next turn uses it without restarting the conversation: a structured
 * session (Claude, Codex) through its handle, an ACP session through its own
 * set requests. PTY transports take their selection only at launch; for them
 * the stored pick makes `deliverToLiveSession` restart the session on its
 * next send.
 */
export async function applyLiveChatSelection(sessionId: string): Promise<void> {
  const active = getActiveSession(sessionId);
  if (!active?.providerId || active.kind !== 'chat') return;
  if (!active.chatHandle && active.mode !== 'acp') return;
  const [item] = db
    .select()
    .from(workItems)
    .where(eq(workItems.id, active.workItemId))
    .limit(1)
    .all();

  if (active.mode === 'acp') {
    const next = await requireAcpControls(sessionId).applySelection((catalog) =>
      resolveChatLaunchConfig(catalog, item, sessionId)
    );
    setActiveSessionLaunch(sessionId, next);
    return;
  }

  const next = resolveChatLaunchConfig(
    await getAgentControlCatalog(active.providerId, sessionId),
    item,
    sessionId
  );
  if (!active.chatHandle || !launchConfigChanged(active.launch, next)) return;
  await active.chatHandle.applySelection(next);
  setActiveSessionLaunch(sessionId, next);
  // The mode is resolved per model (Claude's auto mode is not on every
  // model), so a model switch re-applies the session's mode pick.
  await applyLivePermissionMode(
    active.workItemId,
    getChatPermissionMode(active.workItemId, sessionId),
    sessionId
  );
}
