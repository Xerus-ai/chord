import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { isBundleCoveredBy, type BundleContent, type ExecutableBundle } from './executable-bundle';

/**
 * What a lane may run. Opening a repository is never the same as running
 * its code: only an executable bundle (`executable-bundle.ts`) the user
 * approved runs — approved for this lane ("Run scripts"), or for every lane
 * of the repository ("Always trust") while it still fetches from the same
 * remote. An approval covers that content and anything that runs less of it
 * (`isBundleCoveredBy`): the user's own script replacing one of the team's
 * leaves the rest approved. A new or changed script asks again.
 *
 * Approvals come only from main's own window (`ask-script-approval.ts`); the
 * renderer can never supply one. "Don't run" records nothing.
 */

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** `bundle` is what was approved, or runs less of it. */
function coversBundle(
  approved: { hash: string | null; content: string | null },
  bundle: ExecutableBundle
): boolean {
  if (approved.hash === bundle.hash) return true;
  // Approvals recorded before the content was kept cover exactly their hash.
  if (approved.content === null) return false;
  return isBundleCoveredBy(JSON.parse(approved.content) as BundleContent, bundle.content);
}

export function isBundleApproved(args: {
  laneId: string;
  repoId: string | null;
  bundle: ExecutableBundle;
  remoteUrl: string | null;
}): boolean {
  if (args.repoId === null) return false;
  const [lane] = db
    .select({
      hash: workItemWorktrees.approvedScriptsHash,
      content: workItemWorktrees.approvedScripts,
    })
    .from(workItemWorktrees)
    .where(eq(workItemWorktrees.id, args.laneId))
    .limit(1)
    .all();
  if (lane && coversBundle(lane, args.bundle)) return true;

  const [repo] = db
    .select({
      hash: repoSettings.trustedScriptsHash,
      content: repoSettings.trustedScripts,
      trustedRemoteUrl: repoSettings.trustedRemoteUrl,
    })
    .from(repoSettings)
    .where(eq(repoSettings.repoId, args.repoId))
    .limit(1)
    .all();
  if (!repo || repo.trustedRemoteUrl !== args.remoteUrl) return false;
  // Always trust covers every lane of the repository, an adopted checkout
  // (which runs no teardown) included.
  return coversBundle(repo, args.bundle);
}

export function recordLaneApproval(laneId: string, bundle: ExecutableBundle): void {
  db.update(workItemWorktrees)
    .set({ approvedScriptsHash: bundle.hash, approvedScripts: JSON.stringify(bundle.content) })
    .where(eq(workItemWorktrees.id, laneId))
    .run();
}

export function recordRepoApproval(args: {
  repoId: string;
  hash: string;
  content: BundleContent;
  remoteUrl: string | null;
}): void {
  const values = {
    trustedScriptsHash: args.hash,
    trustedScripts: JSON.stringify(args.content),
    trustedRemoteUrl: args.remoteUrl,
    trustDecidedAt: nowSeconds(),
  };
  db.insert(repoSettings)
    .values({ repoId: args.repoId, ...values })
    .onConflictDoUpdate({ target: repoSettings.repoId, set: values })
    .run();
}

export function revokeRepoApproval(repoId: string): void {
  db.update(repoSettings)
    .set({
      trustedScriptsHash: null,
      trustedScripts: null,
      trustedRemoteUrl: null,
      trustDecidedAt: nowSeconds(),
    })
    .where(eq(repoSettings.repoId, repoId))
    .run();
}

/** This repository's lanes that hold a lane approval. */
function approvedLanesOf(repoId: string) {
  return and(
    inArray(
      workItemWorktrees.workItemId,
      db.select({ id: workItems.id }).from(workItems).where(eq(workItems.repoId, repoId))
    ),
    isNotNull(workItemWorktrees.approvedScriptsHash)
  );
}

/**
 * Repo › Trust › Revoke: takes back every approval this repository has —
 * Always trust and each lane's — so the next script of any lane asks again.
 * It only ever takes trust away; granting goes through main's own window.
 */
export function revokeAllApprovals(repoId: string): { lanes: number } {
  return db.transaction((tx) => {
    const lanes = tx
      .update(workItemWorktrees)
      .set({ approvedScriptsHash: null, approvedScripts: null })
      .where(approvedLanesOf(repoId))
      .run().changes;
    tx.update(repoSettings)
      .set({
        trustedScriptsHash: null,
        trustedScripts: null,
        trustedRemoteUrl: null,
        trustDecidedAt: nowSeconds(),
      })
      .where(eq(repoSettings.repoId, repoId))
      .run();
    return { lanes };
  });
}

export interface RepoApprovals {
  alwaysTrusted: { content: BundleContent; remoteUrl: string | null; decidedAt: number } | null;
  approvedLaneCount: number;
}

/** What is approved for a repository, for its Trust section. */
export function readRepoApprovals(repoId: string): RepoApprovals {
  const [row] = db
    .select({
      trustedScripts: repoSettings.trustedScripts,
      trustedRemoteUrl: repoSettings.trustedRemoteUrl,
      trustDecidedAt: repoSettings.trustDecidedAt,
    })
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repoId))
    .limit(1)
    .all();
  const [lanes] = db
    .select({ total: sql<number>`count(*)` })
    .from(workItemWorktrees)
    .where(approvedLanesOf(repoId))
    .all();
  return {
    alwaysTrusted:
      row?.trustedScripts && row.trustDecidedAt !== null
        ? {
            content: JSON.parse(row.trustedScripts) as BundleContent,
            remoteUrl: row.trustedRemoteUrl,
            decidedAt: row.trustDecidedAt,
          }
        : null,
    approvedLaneCount: lanes?.total ?? 0,
  };
}

/** The content last approved with Always trust — what the next prompt diffs against. */
export function readAlwaysTrustedContent(repoId: string): BundleContent | null {
  const [row] = db
    .select({ trustedScripts: repoSettings.trustedScripts })
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repoId))
    .limit(1)
    .all();
  return row?.trustedScripts ? (JSON.parse(row.trustedScripts) as BundleContent) : null;
}
