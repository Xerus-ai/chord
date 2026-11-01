import type { PlanRequestPutBody } from '@chord/protocol';
import { and, eq } from 'drizzle-orm';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { db } from '@main/db/client';
import { publishedPlanRequests } from '@main/db/schema-sync';
import { log } from '@main/lib/logger';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

class PlanPublicationService {
  publish(request: {
    workItemId: string;
    sessionId: string | null;
    requestId: string;
    title: string;
    overview: string;
    steps: Array<{ text: string; completed: boolean }>;
  }): void {
    db.insert(publishedPlanRequests)
      .values({
        requestId: request.requestId,
        workItemId: request.workItemId,
        sessionId: request.sessionId,
        title: request.title,
        overview: request.overview,
        steps: JSON.stringify(request.steps),
        status: 'pending',
      })
      .onConflictDoNothing()
      .run();

    const body: PlanRequestPutBody = {
      work_item_id: request.workItemId,
      session_id: request.sessionId,
      title: request.title,
      overview: request.overview,
      steps: request.steps,
      status: 'pending',
    };
    syncQueueService.enqueuePlanRequestCreate(request.requestId, body);
  }

  resolve(
    workItemId: string,
    requestId: string,
    action: 'approve' | 'reject',
    resolvedBy: string | null
  ): boolean {
    const published = this.getPublishedRequest(requestId);
    if (!published || published.status !== 'pending') return false;

    if (!this.settleLedgerRow(requestId, 'resolved')) return false;

    syncQueueService.enqueuePlanRequestUpdate(requestId, {
      work_item_id: workItemId,
      status: 'resolved',
      resolution: action,
      resolved_by: resolvedBy,
    });
    return true;
  }

  expireForSession(sessionId: string): void {
    const pending = db
      .select()
      .from(publishedPlanRequests)
      .where(
        and(
          eq(publishedPlanRequests.sessionId, sessionId),
          eq(publishedPlanRequests.status, 'pending')
        )
      )
      .all();
    for (const row of pending) {
      this.expireRow(row.requestId, row.workItemId);
    }
    if (pending.length > 0) {
      log.info('[plans] expired published requests for ended session', {
        sessionId,
        count: pending.length,
      });
    }
  }

  reconcileOnStartup(): void {
    const pending = db
      .select()
      .from(publishedPlanRequests)
      .where(eq(publishedPlanRequests.status, 'pending'))
      .all();
    for (const row of pending) {
      this.expireRow(row.requestId, row.workItemId);
    }
    if (pending.length > 0) {
      log.info('[plans] startup reconcile expired orphaned published requests', {
        count: pending.length,
      });
    }
  }

  getPublishedRequest(requestId: string): {
    status: 'pending' | 'resolved' | 'expired';
    /** The Chord session that presented the plan — the only one that may answer it. */
    sessionId: string | null;
    title: string;
    overview: string;
    steps: Array<{ text: string; completed: boolean }>;
  } | null {
    const row = db
      .select({
        status: publishedPlanRequests.status,
        sessionId: publishedPlanRequests.sessionId,
        title: publishedPlanRequests.title,
        overview: publishedPlanRequests.overview,
        steps: publishedPlanRequests.steps,
      })
      .from(publishedPlanRequests)
      .where(eq(publishedPlanRequests.requestId, requestId))
      .get();
    if (!row) return null;
    return {
      status: row.status as 'pending' | 'resolved' | 'expired',
      sessionId: row.sessionId,
      title: row.title,
      overview: row.overview,
      steps: JSON.parse(row.steps) as Array<{ text: string; completed: boolean }>,
    };
  }

  private expireRow(requestId: string, workItemId: string): void {
    if (!this.settleLedgerRow(requestId, 'expired')) return;
    syncQueueService.enqueuePlanRequestUpdate(requestId, {
      work_item_id: workItemId,
      status: 'expired',
      resolution: 'expired',
      resolved_by: null,
    });
  }

  private settleLedgerRow(requestId: string, status: 'resolved' | 'expired'): boolean {
    const result = db
      .update(publishedPlanRequests)
      .set({ status, resolvedAt: nowSeconds() })
      .where(
        and(
          eq(publishedPlanRequests.requestId, requestId),
          eq(publishedPlanRequests.status, 'pending')
        )
      )
      .run();
    return result.changes > 0;
  }
}

export const planPublicationService = new PlanPublicationService();
