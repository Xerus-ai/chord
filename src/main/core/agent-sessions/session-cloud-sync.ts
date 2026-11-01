/**
 * Cloud sync of the agent CHAT-session registry (devstation-uka). Debounced
 * per work item and shaped exactly like worktree-cloud-sync.ts, which solves
 * the same problem for `work_item_worktrees`: a burst of local changes (a
 * session created and titled a moment later, several turns finishing at once)
 * collapses into one push, because the sync-queue's 'sessions' entity
 * whole-replaces on merge and nothing is lost by waiting.
 *
 * Why this exists: a participant's client has no access to the owner's
 * SQLite, so without this registry it cannot know which threads a shared work
 * item has. That is what kept teammates on one merged feed after the Room was
 * removed, and what made the server stamp `session_id: null` on every live
 * participant message.
 */
import { eq } from 'drizzle-orm';
import { isValidProviderId } from '@shared/agent-provider-registry';
import { db } from '@main/db/client';
import { agentSessions, workItems, type AgentSessionRow } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { getAgentControlCatalog } from '../agent-catalog/catalog-service';
import { gitStateCaptureService } from '../work-items/git-state-capture';
import { syncQueueService } from '../work-items/sync-queue-service';
import { buildSessionEntries, type PublishableSessionRow } from './build-session-entries';
import { getChatPermissionMode } from './permission-mode-store';
import { describeSessionAgentLabels } from './session-agent-labels';
import { getChatSessionConfig } from './session-config-store';

const DEBOUNCE_MS = 2_000;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounces and enqueues a full chat-session push for `workItemId`. Safe to
 * call from any session mutation site — a no-op when the item isn't currently
 * a sync target (`gitStateCaptureService.isSyncTarget`, the same "is this item
 * shared" predicate git-state, worktrees and plan requests use) or when the
 * debounce window is already pending for this item.
 */
export function scheduleSessionCloudSync(workItemId: string): void {
  if (pendingTimers.has(workItemId)) return;
  const timer = setTimeout(() => {
    pendingTimers.delete(workItemId);
    void runSync(workItemId);
  }, DEBOUNCE_MS);
  pendingTimers.set(workItemId, timer);
}

async function runSync(workItemId: string): Promise<void> {
  try {
    if (!gitStateCaptureService.isSyncTarget(workItemId)) return;

    const rows = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.workItemId, workItemId));

    // Unlike worktrees, an EMPTY list is still worth pushing: a work item
    // whose last chat session was deleted must stop advertising a thread tab
    // to everyone it is shared with. The route treats an empty list as
    // "delete them all", which is exactly right here.
    const [item] = await db
      .select({ model: workItems.model })
      .from(workItems)
      .where(eq(workItems.id, workItemId))
      .limit(1);
    const labelled = await Promise.all(
      rows.map(async (row) => withAgentLabels(workItemId, row, item?.model ?? null))
    );
    const entries = buildSessionEntries(labelled);
    syncQueueService.enqueueSessions(workItemId, { sessions: entries });
  } catch (error) {
    // Fail-soft per cycle, matching worktree-cloud-sync and
    // git-state-capture: a build/enqueue failure must not crash the trigger
    // site (session create, status change, turn completion). The next trigger
    // retries from scratch.
    log.warn('[session-cloud-sync] failed to build/enqueue session registry', {
      workItemId,
      error: String(error),
    });
  }
}

const NO_LABELS = { modelLabel: null, permissionModeLabel: null };

/**
 * A chat row with the model and mode its owner's composer shows, for a
 * teammate's composer (user decision 2026-10-01): the session's own pick,
 * else the work item's default model, named by the agent's catalog. The
 * labels are display only and the registry is what a teammate's tabs stand
 * on, so a catalog that cannot be read is logged and the chat publishes
 * unnamed rather than holding back the whole push.
 */
async function withAgentLabels(
  workItemId: string,
  row: AgentSessionRow,
  itemModel: string | null
): Promise<PublishableSessionRow> {
  if (row.kind !== 'chat' || !isValidProviderId(row.agentProviderId)) {
    return { ...row, ...NO_LABELS };
  }
  try {
    const catalog = await getAgentControlCatalog(row.agentProviderId, row.id);
    const labels = describeSessionAgentLabels(catalog, {
      model: getChatSessionConfig(row.id).model ?? itemModel,
      permissionMode: getChatPermissionMode(workItemId, row.id),
    });
    return { ...row, ...labels };
  } catch (error) {
    log.warn('[session-cloud-sync] could not name the model and mode of a chat', {
      workItemId,
      sessionId: row.id,
      error: String(error),
    });
    return { ...row, ...NO_LABELS };
  }
}
