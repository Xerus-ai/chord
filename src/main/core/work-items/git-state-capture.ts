import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { db } from '@main/db/client';
import { syncQueue } from '@main/db/schema-sync';
import { workItems } from '@main/db/schema-work-items';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { fetchCloudWorkItemMemberSummary, fetchCloudWorkItems } from './cloud-work-items-client';
import { buildGitStateSnapshot, readGitStateInputs, type SharedTarget } from './git-state-snapshot';
import { syncQueueService } from './sync-queue-service';

const CAPTURE_INTERVAL_MS = 20_000;
// The shared-item set lives on the cloud (member rows + general_access),
// so it refreshes on its own slower cadence to bound REST chatter.
const SHARED_SET_REFRESH_MS = 60_000;
// Bounds sustained agent-write churn (and the participant's Monaco remount
// rate) to at most ~3 pushes per minute per item.
const MIN_PUSH_INTERVAL_MS = 20_000;

export class GitStateCaptureService implements IInitializable, IDisposable {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private sharedTargets: SharedTarget[] = [];
  private sharedSetFetchedAt = 0;
  private lastPushedFingerprint = new Map<string, string>();
  private lastPushAt = new Map<string, number>();
  /** Per-file content hashes known-delivered — see reconcileConfirmedHashes. */
  private confirmedContentHash = new Map<string, Map<string, string>>();
  /** Per-file content hashes from the push most recently enqueued, awaiting delivery confirmation. */
  private pendingContentHash = new Map<string, Map<string, string>>();
  private targetsAddedListeners = new Set<(workItemIds: string[]) => void>();

  /**
   * Called with the items that just became shared, once the set holds them
   * (isSyncTarget is true for them). What a teammate reads besides git state —
   * the chat-session and worktree registries — is pushed on its own changes
   * only, so it must also be pushed here (devstation-9ld).
   */
  onTargetsAdded(listener: (workItemIds: string[]) => void): () => void {
    this.targetsAddedListeners.add(listener);
    return () => this.targetsAddedListeners.delete(listener);
  }

  initialize(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, CAPTURE_INTERVAL_MS);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Kicked by work-item save events (e.g. a branch rename) so metadata edits
   * surface ahead of the next interval. Also forces the shared-set refresh —
   * a kick right after sharing starts capture without the 60s lag.
   */
  kick(): void {
    this.sharedSetFetchedAt = 0;
    void this.tick();
  }

  /**
   * Reuses this service's "is this item shared" predicate (team access, or
   * a work-item member — see refreshSharedTargets; an artifact shared alone
   * never counts) for T0.8's worktree metadata sync: worktree
   * sub-rows are a shared-item / Team surface, same as git-state and plan
   * requests, so they must sync for exactly the same item set and no other.
   * Reads the in-memory set refreshed on SHARED_SET_REFRESH_MS's cadence —
   * no extra network call.
   */
  isSyncTarget(workItemId: string): boolean {
    return this.sharedTargets.some((target) => target.workItemId === workItemId);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const session = await chordAccountService.getSession();
      if (session.authState !== 'signed_in') {
        // Sign-out stops capture and drops all state; a later sign-in starts
        // from a fresh shared-set fetch and re-pushes current snapshots.
        this.sharedTargets = [];
        this.sharedSetFetchedAt = 0;
        this.lastPushedFingerprint.clear();
        this.lastPushAt.clear();
        this.confirmedContentHash.clear();
        this.pendingContentHash.clear();
        return;
      }

      await this.refreshSharedTargets();

      for (const target of this.sharedTargets) {
        try {
          await this.captureItem(target);
        } catch (error) {
          // Fail-fast per item: push nothing, keep last-known-good on the
          // cloud, move on to the other shared items.
          log.warn('[git-capture] capture failed, pushing nothing', {
            workItemId: target.workItemId,
            error: String(error),
          });
        }
      }
    } catch (error) {
      log.warn('[git-capture] tick skipped', { error: String(error) });
    } finally {
      this.running = false;
    }
  }

  private async refreshSharedTargets(): Promise<void> {
    const now = Date.now();
    if (now - this.sharedSetFetchedAt < SHARED_SET_REFRESH_MS) return;

    const cloudRows = await fetchCloudWorkItems();
    const localById = new Map(
      db
        .select()
        .from(workItems)
        .all()
        .map((row) => [row.id, row])
    );

    // One bulk call for every owned item instead of one request per item.
    const memberSummary = await fetchCloudWorkItemMemberSummary();
    const hasMembers = new Set(
      memberSummary.filter((s) => s.has_members).map((s) => s.work_item_id)
    );

    const targets: SharedTarget[] = [];
    for (const cloud of cloudRows) {
      const local = localById.get(cloud.id);
      if (!local || !local.repoPath) continue;
      // Shared = someone else can open the work item itself: its team, or a
      // member. Artifact-only access never reaches git state.
      if (cloud.general_access === 'team' || hasMembers.has(cloud.id)) {
        targets.push({ workItemId: cloud.id, repoPath: local.repoPath });
      }
    }

    // Revoked/deleted/unshared items drop out of the set; forget their
    // fingerprints so a later re-share pushes a fresh snapshot immediately.
    const activeIds = new Set(targets.map((t) => t.workItemId));
    for (const id of this.lastPushedFingerprint.keys()) {
      if (!activeIds.has(id)) {
        this.lastPushedFingerprint.delete(id);
        this.lastPushAt.delete(id);
        this.confirmedContentHash.delete(id);
        this.pendingContentHash.delete(id);
      }
    }

    const previousIds = new Set(this.sharedTargets.map((t) => t.workItemId));
    this.sharedTargets = targets;
    this.sharedSetFetchedAt = now;
    const added = targets.map((t) => t.workItemId).filter((id) => !previousIds.has(id));
    if (added.length > 0) {
      for (const listener of this.targetsAddedListeners) listener(added);
    }
  }

  private async captureItem(target: SharedTarget): Promise<void> {
    const { workItemId, repoPath } = target;

    // Stage 1 — cheap fingerprint over the same reads the snapshot is built from.
    const { branch, porcelain, numstat } = await readGitStateInputs(repoPath);

    const fingerprint = createHash('sha256')
      .update(branch)
      .update('\0')
      .update(porcelain)
      .update('\0')
      .update(numstat)
      .digest('hex');

    if (this.lastPushedFingerprint.get(workItemId) === fingerprint) return;

    const lastPush = this.lastPushAt.get(workItemId) ?? 0;
    if (Date.now() - lastPush < MIN_PUSH_INTERVAL_MS) return; // next tick retries

    // Stage 2 — full capture.
    this.reconcileConfirmedHashes(workItemId);
    const { body, contentHashes } = await buildGitStateSnapshot(
      target,
      branch,
      porcelain,
      numstat,
      this.confirmedContentHash.get(target.workItemId)
    );
    this.pendingContentHash.set(target.workItemId, contentHashes);
    syncQueueService.enqueueGitState(workItemId, body);
    this.lastPushedFingerprint.set(workItemId, fingerprint);
    this.lastPushAt.set(workItemId, Date.now());
    log.info('[git-capture] snapshot enqueued', {
      workItemId,
      files: body.files.length,
      contents: body.contents.length,
    });
  }

  /**
   * Promotes the previous push's assumed content hashes from "pending" to
   * "confirmed" once — and only once — that specific push's sync_queue row
   * is gone (delivered; see the class doc for why "enqueued" isn't good
   * enough). Three outcomes for the most recent git_state row, by status:
   *  - none: the row is gone — delivered — promote pending to confirmed.
   *  - in flight (pending/processing): still unresolved, touch nothing.
   *  - failed: the server explicitly rejected it (e.g. the 409 divergence
   *    response in git-state.ts, or retries exhausted) — its assumed hashes
   *    were never applied, so drop them rather than promote OR leave them
   *    sitting around forever; the confirmed baseline stays whatever it last
   *    was, and the next capture rebuilds `pendingContentHash` from scratch
   *    against it. This is the client half of the divergence fallback: no
   *    special-cased status/body parsing needed, since a failed delta always
   *    surfaces here as "don't trust what I assumed", and full content for
   *    anything not already solidly confirmed goes out on the very next push.
   * Read-only against sync_queue: this observes sync-queue-service's own
   * durable state instead of duplicating its delivery tracking.
   */
  private reconcileConfirmedHashes(workItemId: string): void {
    const status = this.mostRecentGitStatePushStatus(workItemId);
    if (status === 'in_flight') return;
    if (status === 'failed') {
      this.pendingContentHash.delete(workItemId);
      return;
    }
    const pending = this.pendingContentHash.get(workItemId);
    if (pending) {
      this.confirmedContentHash.set(workItemId, pending);
      this.pendingContentHash.delete(workItemId);
    }
  }

  private mostRecentGitStatePushStatus(workItemId: string): 'none' | 'in_flight' | 'failed' {
    // Most recent by id, not "any row": a permanently-failed row is never
    // deleted (only enqueueGitState's merge-into-pending can reuse a row,
    // per sync-queue-service.ts's mergeOrInsert — a 'failed' row doesn't
    // qualify, so the next push after a failure inserts a fresh one). Without
    // ordering, a stale failed row from long ago would keep matching forever
    // and permanently block promotion even after later pushes succeed.
    const [row] = db
      .select({ status: syncQueue.status })
      .from(syncQueue)
      .where(and(eq(syncQueue.entityType, 'git_state'), eq(syncQueue.entityId, workItemId)))
      .orderBy(desc(syncQueue.id))
      .limit(1)
      .all();
    if (!row) return 'none';
    return row.status === 'failed' ? 'failed' : 'in_flight';
  }
}

export const gitStateCaptureService = new GitStateCaptureService();
