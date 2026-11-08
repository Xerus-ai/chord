import { eq } from 'drizzle-orm';
import type { ResolvedRepoConfig } from '@shared/repo-config';
import { readFetchRemoteUrl } from '@main/core/repo-config/fetch-remote-url';
import { resolveDefaultBaseRef } from '@main/core/repo-config/resolve-lane-base';
import { resolveRepoConfig } from '@main/core/repo-config/resolve-repo-config';
import {
  buildExecutableBundle,
  collectChordScripts,
  readClaudeExecutableConfig,
  selectCheckoutScripts,
  type ExecutableBundle,
} from '@main/core/workspaces/executable-bundle';
import { db } from '@main/db/client';
import { workItems, type WorkItemWorktreeRow } from '@main/db/schema-work-items';
import { resolveMainRepoPathForWorkItem } from './repo-path';
import { findWorktreeRow, laneSessionCwd } from './worktree-lookup';

/**
 * What a lane would run, read at the moment it runs: `.chord.json` at the
 * lane's target ref (never the checkout's own copy, which an agent can
 * edit), plus the Claude config its sessions load — the checkout's, or for a
 * lane nested in a companion worktree the companion's, where its sessions
 * start (`laneSessionCwd`) — as one bundle to approve, holding only what this
 * checkout runs (`selectCheckoutScripts`). A just-me companion gets no trust
 * exception: its config is approved like the repository's.
 */

export interface LaneBundle {
  row: WorkItemWorktreeRow;
  repoId: string | null;
  /** The repository's main checkout. */
  sourcePath: string;
  targetRef: string;
  config: ResolvedRepoConfig;
  bundle: ExecutableBundle | null;
  /** URL of the remote this lane fetches from; null for a repository with none. */
  remoteUrl: string | null;
  /** The companion worktree the Claude config was read from; null when it is the checkout's. */
  claudeSource: string | null;
}

/** Throws for a lane or work item that does not exist, and on an invalid `.chord.json`. */
export async function resolveLaneBundle(laneId: string): Promise<LaneBundle> {
  const row = findWorktreeRow(laneId);
  if (!row) throw new Error(`Lane ${laneId} does not exist`);
  const [workItem] = db
    .select()
    .from(workItems)
    .where(eq(workItems.id, row.workItemId))
    .limit(1)
    .all();
  if (!workItem) throw new Error(`Lane ${laneId} references missing work item ${row.workItemId}`);

  const sourcePath = await resolveMainRepoPathForWorkItem(workItem, row);
  let targetRef = row.targetRef;
  if (!targetRef) {
    const resolved = await resolveDefaultBaseRef(sourcePath);
    if (!resolved.success) throw new Error(resolved.error.message);
    targetRef = resolved.data;
  }
  const config = await resolveRepoConfig({
    repoId: workItem.repoId,
    repoPath: sourcePath,
    ref: targetRef,
  });
  const bundle = buildExecutableBundle(
    selectCheckoutScripts(collectChordScripts(config), row.checkoutOrigin),
    await readClaudeExecutableConfig(laneSessionCwd(row))
  );
  return {
    row,
    repoId: workItem.repoId,
    sourcePath,
    targetRef,
    config,
    bundle,
    remoteUrl: await readFetchRemoteUrl(sourcePath, config.remote.value),
    claudeSource: row.companionPath,
  };
}
