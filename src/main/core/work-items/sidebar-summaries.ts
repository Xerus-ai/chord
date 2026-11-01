/**
 * The sidebar's one-round-trip read: per work item, its worktrees' status
 * buckets, live sessions, diff stats, and Needs You reasons.
 *
 * Two of the bucket-derivation facts are sourced from columns added for this
 * purpose (see schema-work-items.ts and sidebar-worktree-summaries.ts):
 * - `lastTurnErrored` is derived by `buildWorktreeSummary` from each
 *   session's `lastTurnStatus` (below), not passed in directly.
 * - `gitOperationFailed` comes straight off `work_item_worktrees.git_last_error`,
 *   set by `commitAndPushWorkItem`/`pushWorkItemBranch` via
 *   `recordGitOperationOutcome` (git-operation-status.ts). `sync_queue`'s
 *   'git_state' failures (git-state-capture.ts) are a different signal — a
 *   cloud snapshot push failing, not a `git push` — and are not reused here
 *   to avoid conflating the two.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { derivePrState } from '@shared/pr-status-badge';
import {
  pullRequestNumber,
  type NeedsYouReason,
  type SidebarPullRequestSummary,
  type SidebarSummary,
  type SidebarWorktreeSummary,
} from '@shared/sidebar-summaries';
import type { SidebarLastViewedAtSnapshot } from '@shared/view-state';
import { deriveWorkItemStatus, type WorkItemPullRequestContext } from '@shared/work-item-status';
import { appSettingsService } from '@main/core/settings/settings-service';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { publishedPermissionRequests, publishedPlanRequests } from '@main/db/schema-sync';
import {
  agentSessions,
  workItems,
  workItemWorktrees,
  type WorkItemWorktreeRow,
} from '@main/db/schema-work-items';
import { listActiveSessions } from './active-sessions';
import { deriveChecksPassing, deriveChecksState, type CheckFacts } from './checks-passing';
import { getDevServerUrl } from './dev-server-urls';
import { buildNeedsYouReasons } from './needs-you';
import { readUnseenMentionCounts } from './needs-you-mention-reads';
import { readOncePerCheckout } from './read-once-per-checkout';
import { readDescriptions, readNewestTurnTimes } from './sidebar-chat-reads';
import { countByWorkItem, readArchivedLaneCounts } from './sidebar-counts';
import { readPullRequestData, type PrFacts } from './sidebar-pr-reads';
import {
  attributePendingRequests,
  buildWorktreeSummary,
  computeUnread,
  type WorktreeLiveSessionFacts,
  type WorktreeSessionFacts,
} from './sidebar-worktree-summaries';
import {
  readWorktreeBranchState,
  readWorktreeChangeSummary,
  type WorktreeBranchState,
} from './worktree-change-summary';
import { aggregateDiffStats } from './worktree-diff-stats';

/** The branch the primary checkout is on; null for a detached, missing or unreadable one. */
function checkoutBranchOf(branch: WorktreeBranchState | null): string | null {
  return branch?.kind === 'readable' ? branch.info.currentBranch : null;
}

function sortWorktrees(rows: WorkItemWorktreeRow[]): WorkItemWorktreeRow[] {
  return [...rows].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return b.isPrimary - a.isPrimary;
    return a.createdAt - b.createdAt;
  });
}

/** Groups local `agent_sessions` rows by their resolved worktree, and
 * indexes session id -> worktree id for every other query that needs it. */
function indexSessions(
  sessionRows: {
    id: string;
    workItemId: string;
    worktreeId: string | null;
    status: string;
    kind: string;
    agentProviderId: string | null;
    title: string | null;
    createdAt: number;
    lastActiveAt: number;
    lastTurnStatus: string | null;
  }[],
  primaryWorktreeIdByWorkItem: ReadonlyMap<string, string>
) {
  const sessionWorktreeId = new Map<string, string>();
  const sessionsByWorktree = new Map<string, WorktreeSessionFacts[]>();
  const sessionCounts = new Map<string, number>();
  const newestActiveSessionWorktree = new Map<
    string,
    { worktreeId: string; lastActiveAt: number }
  >();

  for (const session of sessionRows) {
    if (session.status !== 'done') {
      sessionCounts.set(session.workItemId, (sessionCounts.get(session.workItemId) ?? 0) + 1);
    }
    const worktreeId = session.worktreeId ?? primaryWorktreeIdByWorkItem.get(session.workItemId);
    if (!worktreeId) continue;
    sessionWorktreeId.set(session.id, worktreeId);
    sessionsByWorktree.set(worktreeId, [
      ...(sessionsByWorktree.get(worktreeId) ?? []),
      {
        id: session.id,
        status: session.status,
        kind: session.kind,
        agentProviderId: session.agentProviderId,
        title: session.title,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        lastTurnStatus: session.lastTurnStatus,
      },
    ]);
    if (session.status === 'active') {
      const current = newestActiveSessionWorktree.get(session.workItemId);
      if (!current || session.lastActiveAt > current.lastActiveAt) {
        newestActiveSessionWorktree.set(session.workItemId, {
          worktreeId,
          lastActiveAt: session.lastActiveAt,
        });
      }
    }
  }
  return { sessionWorktreeId, sessionsByWorktree, sessionCounts, newestActiveSessionWorktree };
}

/** Live turn state and subagent names, from main-process memory — a
 * session's row exists the moment it is created, but only a currently-held
 * ActiveSession can report whether a turn is streaming. */
function indexLiveSessions(
  ids: string[],
  sessionWorktreeId: ReadonlyMap<string, string>,
  primaryWorktreeIdByWorkItem: ReadonlyMap<string, string>
): Map<string, WorktreeLiveSessionFacts[]> {
  const liveSessionsByWorktree = new Map<string, WorktreeLiveSessionFacts[]>();
  for (const session of listActiveSessions()) {
    if (!ids.includes(session.workItemId)) continue;
    const worktreeId =
      sessionWorktreeId.get(session.sessionId) ??
      primaryWorktreeIdByWorkItem.get(session.workItemId);
    if (!worktreeId) continue;

    const snapshot = session.bridge?.getLiveTurnSnapshot() ?? null;
    const subagentItem = snapshot
      ? [...snapshot.items].reverse().find((item) => item.kind === 'subagent')
      : undefined;
    const subagents =
      subagentItem && subagentItem.kind === 'subagent'
        ? subagentItem.agents
            .filter((agent) => agent.status === 'running')
            .map((agent) => ({ name: agent.name }))
        : [];

    liveSessionsByWorktree.set(worktreeId, [
      ...(liveSessionsByWorktree.get(worktreeId) ?? []),
      { sessionId: session.sessionId, isTurnStreaming: snapshot !== null, subagents },
    ]);
  }
  return liveSessionsByWorktree;
}

/**
 * The row's view of a PR. The number comes from the URL — the same parse
 * `pullRequestKey` uses — so a stored URL that is not a GitHub pull request
 * yields no PR facts at all rather than a row claiming `#NaN`.
 */
function buildPullRequestSummary(
  pr: PrFacts,
  checks: readonly CheckFacts[]
): SidebarPullRequestSummary | null {
  const number = pullRequestNumber(pr.url);
  if (number === null) return null;
  const checksState = deriveChecksState(checks, pr.headRefOid);
  return {
    url: pr.url,
    number,
    state: derivePrState(pr),
    checks: checksState === 'none' ? null : checksState,
  };
}

export async function collectSidebarSummaries(ids: string[]): Promise<SidebarSummary[]> {
  if (ids.length === 0) return [];

  const rows = await db.select().from(workItems).where(inArray(workItems.id, ids));
  if (rows.length === 0) return [];

  const worktreeRows = await db
    .select()
    .from(workItemWorktrees)
    .where(and(inArray(workItemWorktrees.workItemId, ids), isNull(workItemWorktrees.archivedAt)));
  const archivedLaneCounts = await readArchivedLaneCounts(ids);

  const worktreesByWorkItem = new Map<string, WorkItemWorktreeRow[]>();
  const primaryWorktreeIdByWorkItem = new Map<string, string>();
  for (const w of worktreeRows) {
    worktreesByWorkItem.set(w.workItemId, [...(worktreesByWorkItem.get(w.workItemId) ?? []), w]);
    if (w.isPrimary === 1) primaryWorktreeIdByWorkItem.set(w.workItemId, w.id);
  }

  // Branch resolution is per checkout path, not per work item: every
  // worktree is its own `git worktree`, so its current branch only makes
  // sense read from its own directory.
  const worktreePaths = [...new Set(worktreeRows.map((w) => w.path))];
  const branchByPath = new Map(
    await Promise.all(
      worktreePaths.map(async (path) => [path, await readWorktreeBranchState(path)] as const)
    )
  );
  const branchFor = (path: string) => {
    const branch = branchByPath.get(path);
    if (!branch) throw new Error(`No branch state read for checkout ${path}`);
    return branch;
  };
  const { compareBase: compareBaseMode } = await appSettingsService.get('git');
  const changesByWorktree = await readOncePerCheckout(worktreeRows, (w) =>
    readWorktreeChangeSummary(w, branchFor(w.path), compareBaseMode)
  );
  const changesFor = (worktreeId: string) => {
    const changes = changesByWorktree.get(worktreeId);
    if (!changes) throw new Error(`No change summary read for worktree ${worktreeId}`);
    return changes;
  };

  const sessionRows = await db
    .select({
      id: agentSessions.id,
      workItemId: agentSessions.workItemId,
      worktreeId: agentSessions.worktreeId,
      status: agentSessions.status,
      kind: agentSessions.kind,
      agentProviderId: agentSessions.agentProviderId,
      title: agentSessions.title,
      createdAt: agentSessions.createdAt,
      lastActiveAt: agentSessions.lastActiveAt,
      lastTurnStatus: agentSessions.lastTurnStatus,
    })
    .from(agentSessions)
    .where(inArray(agentSessions.workItemId, ids));
  const { sessionWorktreeId, sessionsByWorktree, sessionCounts, newestActiveSessionWorktree } =
    indexSessions(sessionRows, primaryWorktreeIdByWorkItem);

  // A pending request with no session attaches to the newest live session's
  // worktree, else the primary — one still published before any session
  // existed has to belong somewhere.
  const pendingRequestFallback = new Map<string, string>();
  for (const workItemId of ids) {
    const fallback =
      newestActiveSessionWorktree.get(workItemId)?.worktreeId ??
      primaryWorktreeIdByWorkItem.get(workItemId);
    if (fallback) pendingRequestFallback.set(workItemId, fallback);
  }

  const pendingPermissionRows = await db
    .select({
      workItemId: publishedPermissionRequests.workItemId,
      sessionId: publishedPermissionRequests.sessionId,
    })
    .from(publishedPermissionRequests)
    .where(
      and(
        inArray(publishedPermissionRequests.workItemId, ids),
        eq(publishedPermissionRequests.status, 'pending')
      )
    );
  const pendingPlanRows = await db
    .select({
      workItemId: publishedPlanRequests.workItemId,
      sessionId: publishedPlanRequests.sessionId,
    })
    .from(publishedPlanRequests)
    .where(
      and(
        inArray(publishedPlanRequests.workItemId, ids),
        eq(publishedPlanRequests.status, 'pending')
      )
    );

  const pendingPermissionByWorktree = attributePendingRequests(
    pendingPermissionRows,
    sessionWorktreeId,
    pendingRequestFallback
  );
  const pendingPlanByWorktree = attributePendingRequests(
    pendingPlanRows,
    sessionWorktreeId,
    pendingRequestFallback
  );
  const pendingPermissionByWorkItem = countByWorkItem(pendingPermissionRows);
  const pendingPlanByWorkItem = countByWorkItem(pendingPlanRows);

  const liveSessionsByWorktree = indexLiveSessions(
    ids,
    sessionWorktreeId,
    primaryWorktreeIdByWorkItem
  );

  const newestTurnAt = await readNewestTurnTimes(
    ids,
    sessionWorktreeId,
    primaryWorktreeIdByWorkItem
  );
  const lastViewedAt = (await viewStateService.get(
    'sidebar.lastViewedAt'
  )) as SidebarLastViewedAtSnapshot | null;
  const descriptionByWorkItem = await readDescriptions(ids);
  const mentionCounts = await readUnseenMentionCounts(ids, lastViewedAt);

  const prUrls = [...new Set(rows.map((row) => row.prUrl).filter((url): url is string => !!url))];
  const { byUrl: prByUrl, checksByUrl } = await readPullRequestData(prUrls);

  const summaries: SidebarSummary[] = [];
  for (const row of rows) {
    const worktreesForItem = sortWorktrees(worktreesByWorkItem.get(row.id) ?? []);
    if (worktreesForItem.length === 0) {
      throw new Error(`Work item ${row.id} has no non-archived worktrees`);
    }

    const worktreeSummaries: SidebarWorktreeSummary[] = worktreesForItem.map((w) => ({
      ...buildWorktreeSummary({
        id: w.id,
        branch: w.branchName,
        targetRef: w.targetRef,
        title: w.title,
        isPrimary: w.isPrimary === 1,
        diffStats: changesFor(w.id).diffStats,
        sessions: sessionsByWorktree.get(w.id) ?? [],
        liveSessions: liveSessionsByWorktree.get(w.id) ?? [],
        pendingPermissionRequests: pendingPermissionByWorktree.get(w.id) ?? 0,
        pendingPlanRequests: pendingPlanByWorktree.get(w.id) ?? 0,
        gitOperationFailed: !!w.gitLastError,
        hasUnreadFinishedTurn: computeUnread(
          newestTurnAt.byWorktree.get(w.id) ?? null,
          lastViewedAt?.[row.id]
        ),
      }),
      compareBase: changesFor(w.id).compareBase,
    }));

    const pr = row.prUrl ? prByUrl.get(row.prUrl) : undefined;
    const prChecks = pr ? (checksByUrl.get(pr.url) ?? []) : [];
    const pullRequestContext: WorkItemPullRequestContext | null = pr
      ? {
          status: pr.status as WorkItemPullRequestContext['status'],
          isDraft: !!pr.isDraft,
          reviewDecision: pr.reviewDecision,
          checksPassing: deriveChecksPassing(prChecks, pr.headRefOid),
        }
      : null;

    const aggregateBucket = deriveWorkItemStatus(
      worktreeSummaries.map((w) => w.bucket),
      {
        workItemStatus: row.status,
        pullRequest: pullRequestContext,
      }
    );

    const needsYou: NeedsYouReason[] = buildNeedsYouReasons({
      pendingPermissionCount: pendingPermissionByWorkItem.get(row.id) ?? 0,
      pendingPlanCount: pendingPlanByWorkItem.get(row.id) ?? 0,
      mentionCount: mentionCounts.get(row.id) ?? 0,
    });

    const primaryWorktree = worktreesForItem.find((w) => w.isPrimary === 1);

    const devServerUrl =
      worktreesForItem
        .map((w) => getDevServerUrl(w.id))
        .find((url): url is string => url !== null) ?? null;

    summaries.push({
      id: row.id,
      diffStats: aggregateDiffStats(worktreesForItem.map((w) => changesFor(w.id).diffStats)),
      pullRequest: pr ? buildPullRequestSummary(pr, prChecks) : null,
      sessionCount: sessionCounts.get(row.id) ?? 0,
      aggregateBucket,
      worktrees: worktreeSummaries,
      needsYou,
      description: descriptionByWorkItem.get(row.id) ?? null,
      devServerUrl,
      checkoutBranch: checkoutBranchOf(primaryWorktree ? branchFor(primaryWorktree.path) : null),
      lastFinishedTurnAt: newestTurnAt.byWorkItem.get(row.id) ?? null,
      archivedLaneCount: archivedLaneCounts.get(row.id) ?? 0,
    });
  }

  return summaries;
}
