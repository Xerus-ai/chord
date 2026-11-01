import type {
  CloudPermissionOption,
  PermissionRequestPutBody,
  PermissionResolution,
} from '@chord/protocol';
import { and, eq } from 'drizzle-orm';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { db } from '@main/db/client';
import { publishedPermissionRequests } from '@main/db/schema-sync';
import { log } from '@main/lib/logger';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * The cloud row's resolution is the option KIND the answer selected, folded
 * into the wire enum ('reject_always' has no cloud representation — it
 * renders identically to a deny). By construction the answered optionId is
 * one of the published options; a miss means the caller resolved a request
 * this service never published, which is a bug worth failing loudly on.
 */
function toCloudResolution(
  optionId: string,
  options: CloudPermissionOption[]
): Exclude<PermissionResolution, 'expired'> {
  const kind = options.find((o) => o.optionId === optionId)?.kind;
  if (kind === 'allow_once' || kind === 'allow_always' || kind === 'reject_once') return kind;
  if (kind === 'reject_always') return 'reject_once';
  throw new Error(`answered option ${optionId} is not among the published options`);
}

/**
 * The outbound half of remote approvals (design §4): every permission
 * request the agent raises is published to the cloud through the sync-queue
 * so participant views can render it, and RETRACTED the moment it resolves
 * locally — owner click, teammate command, session close, or app restart.
 * The published_permission_requests ledger is what makes the retraction owed
 * by a crashed app recoverable (see reconcileOnStartup); the sync-queue is
 * what makes both directions durable. The loop closes identically whoever
 * answered: resolution tap fires → retraction syncs up → the server
 * broadcasts permission_request_updated → every participant's buttons clear.
 */
class PermissionPublicationService {
  publish(request: {
    workItemId: string;
    sessionId: string | null;
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    options: CloudPermissionOption[];
  }): void {
    // A replayed requestId (SDK retry, respawned bridge) must not clobber a
    // ledger row that already resolved — the late create would resurrect a
    // settled request and re-open Allow buttons cloud-side.
    db.insert(publishedPermissionRequests)
      .values({
        requestId: request.requestId,
        workItemId: request.workItemId,
        sessionId: request.sessionId,
        options: JSON.stringify(request.options),
        status: 'pending',
      })
      .onConflictDoNothing()
      .run();

    const body: PermissionRequestPutBody = {
      work_item_id: request.workItemId,
      session_id: request.sessionId,
      tool_name: request.toolName,
      input: request.input,
      options: request.options,
      status: 'pending',
    };
    syncQueueService.enqueuePermissionRequestCreate(request.requestId, body);
  }

  /**
   * The local-resolution tap — fired by the respondToPermission fan for BOTH
   * answer paths (owner click and delivered permission_response command).
   * optionId is what the session actually received (an agent-defined id for
   * ACP, the wire enum for claude-sdk); the cloud resolution is derived from
   * that option's KIND off the ledger row. resolvedBy is the cloud user id
   * when a command resolved it, null for the owner app. Returns whether this
   * call transitioned the ledger row (false = already settled or never
   * published; nothing further is owed).
   */
  resolve(
    workItemId: string,
    requestId: string,
    optionId: string,
    resolvedBy: string | null
  ): boolean {
    const published = this.getPublishedRequest(requestId);
    if (!published || published.status !== 'pending') return false;

    const resolution = toCloudResolution(optionId, published.options);
    if (!this.settleLedgerRow(requestId, 'resolved')) return false;

    syncQueueService.enqueuePermissionRequestUpdate(requestId, {
      work_item_id: workItemId,
      status: 'resolved',
      resolution,
      resolved_by: resolvedBy,
    });
    return true;
  }

  /**
   * Session-end tap (stop, crash, abort — every removal path funnels through
   * session-service's removeSession): a request whose owning session died
   * can never be answered, so its cloud card must stop offering buttons.
   */
  expireForSession(sessionId: string): void {
    const pending = db
      .select()
      .from(publishedPermissionRequests)
      .where(
        and(
          eq(publishedPermissionRequests.sessionId, sessionId),
          eq(publishedPermissionRequests.status, 'pending')
        )
      )
      .all();
    for (const row of pending) {
      this.expireRow(row.requestId, row.workItemId);
    }
    if (pending.length > 0) {
      log.info('[permissions] expired published requests for ended session', {
        sessionId,
        count: pending.length,
      });
    }
  }

  /**
   * Startup reconciliation (same pattern as the sync-queue's reconcileLocal*
   * backfills): sessions never survive a restart, so every ledger row still
   * 'pending' is a retraction a crash left owed — without this, cloud cards
   * keep live Allow buttons for the full 24h server expiry.
   */
  reconcileOnStartup(): void {
    const pending = db
      .select()
      .from(publishedPermissionRequests)
      .where(eq(publishedPermissionRequests.status, 'pending'))
      .all();
    for (const row of pending) {
      this.expireRow(row.requestId, row.workItemId);
    }
    if (pending.length > 0) {
      log.info('[permissions] startup reconcile expired orphaned published requests', {
        count: pending.length,
      });
    }
  }

  /**
   * Ledger row for the inbox executor: `status` is the "already resolved"
   * owner-veto check; `options` maps a command's option KIND (the wire enum)
   * back to the agent's real optionId — ACP agents use arbitrary ids.
   */
  getPublishedRequest(
    requestId: string
  ): { status: 'pending' | 'resolved' | 'expired'; options: CloudPermissionOption[] } | null {
    const row = db
      .select({
        status: publishedPermissionRequests.status,
        options: publishedPermissionRequests.options,
      })
      .from(publishedPermissionRequests)
      .where(eq(publishedPermissionRequests.requestId, requestId))
      .get();
    if (!row) return null;
    return {
      status: row.status as 'pending' | 'resolved' | 'expired',
      options: JSON.parse(row.options) as CloudPermissionOption[],
    };
  }

  private expireRow(requestId: string, workItemId: string): void {
    if (!this.settleLedgerRow(requestId, 'expired')) return;
    syncQueueService.enqueuePermissionRequestUpdate(requestId, {
      work_item_id: workItemId,
      status: 'expired',
      resolution: 'expired',
      resolved_by: null,
    });
  }

  /** CAS pending → terminal; false when another path settled the row first. */
  private settleLedgerRow(requestId: string, status: 'resolved' | 'expired'): boolean {
    const result = db
      .update(publishedPermissionRequests)
      .set({ status, resolvedAt: nowSeconds() })
      .where(
        and(
          eq(publishedPermissionRequests.requestId, requestId),
          eq(publishedPermissionRequests.status, 'pending')
        )
      )
      .run();
    return result.changes > 0;
  }
}

export const permissionPublicationService = new PermissionPublicationService();
