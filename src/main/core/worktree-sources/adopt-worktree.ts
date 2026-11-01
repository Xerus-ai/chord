import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type {
  AdoptedWorktree,
  AdoptWorktreeError,
  AdoptWorktreeSession,
} from '@shared/worktree-sources';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { resolveDefaultBaseRef } from '@main/core/repo-config/resolve-lane-base';
import { readRepoOrigin } from '@main/core/repos/repo-remotes';
import {
  importAgentSession,
  type ImportAgentSessionArgs,
} from '@main/core/session-import/import-agent-session';
import { appSettingsService } from '@main/core/settings/settings-service';
import { toCloudWorkItemCreateBody } from '@main/core/work-items/cloud-work-items-client';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { scheduleWorktreeCloudSync } from '@main/core/worktrees/worktree-cloud-sync';
import { db } from '@main/db/client';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { preflightAdoption } from './adopt-preflight';

export interface AdoptWorktreeArgs {
  repoId: string;
  path: string;
  /** As the dialog showed it, edited or not. */
  name: string;
  /** The found sessions ticked in the dialog. */
  sessions: AdoptWorktreeSession[];
  sender: ImportAgentSessionArgs['sender'];
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function enqueueCloudCreate(workItemId: string, lanePath: string): Promise<void> {
  const [item] = db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1).all();
  if (!item) throw new Error(`Adopted work item ${workItemId} could not be read back`);
  const { defaultWorkItemAccess } = await appSettingsService.get('sharing');
  syncQueueService.enqueueCreate(
    toCloudWorkItemCreateBody(
      {
        id: item.id,
        name: item.name,
        status: item.status,
        repoAlias: item.repoAlias,
        repoRemoteUrl: await readRepoOrigin(lanePath),
        branchName: item.branchName,
        agentProvider: item.agentProvider,
      },
      defaultWorkItemAccess
    )
  );
}

async function importTickedSessions(
  args: AdoptWorktreeArgs,
  workItemId: string,
  worktreeId: string
): Promise<Pick<AdoptedWorktree, 'imported' | 'importFailures'>> {
  const imported: AdoptedWorktree['imported'] = [];
  const importFailures: AdoptedWorktree['importFailures'] = [];
  for (const session of args.sessions) {
    const result = await importAgentSession({
      workItemId,
      worktreeId,
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
      sender: args.sender,
    });
    if (result.success) {
      imported.push({
        providerSessionId: session.providerSessionId,
        sessionId: result.data.sessionId,
      });
    } else {
      log.warn('[worktree-sources] a ticked session could not be imported', {
        workItemId,
        providerSessionId: session.providerSessionId,
        error: result.error,
      });
      importFailures.push({ providerSessionId: session.providerSessionId, error: result.error });
    }
  }
  return { imported, importFailures };
}

/**
 * Adopts a checkout Chord did not make (plan §Phase 3 slice 6): a work item
 * and one primary lane on the existing folder, marked `adopted` — the user's,
 * so Chord never changes its files or git's worktree list. Nothing runs in
 * it: no fetch (`resolveDefaultBaseRef` reads what this clone knows), no
 * setup until Run setup. The ticked sessions are imported with their
 * history; one that cannot be is reported, and the adoption stands.
 *
 * The caller acquires the lane's workspace (`controller.ts`).
 */
export async function adoptWorktree(
  args: AdoptWorktreeArgs
): Promise<Result<AdoptedWorktree, AdoptWorktreeError>> {
  const [repo] = db.select().from(repos).where(eq(repos.id, args.repoId)).limit(1).all();
  if (!repo) return err({ type: 'repo_not_found' as const });
  const name = args.name.trim();
  if (!name) return err({ type: 'invalid_name' as const });

  const preflight = await preflightAdoption(repo, args.path);
  if (!preflight.success) return preflight;
  const checkout = preflight.data;

  const target = await resolveDefaultBaseRef(repo.path);
  if (!target.success) {
    return err({ type: 'target_unknown' as const, message: target.error.message });
  }

  const workItemId = randomUUID();
  const worktreeId = randomUUID();
  const now = nowSeconds();
  const agentProvider = await appSettingsService.get('defaultAgent');
  const { user } = await chordAccountService.getSession();
  db.transaction((tx) => {
    tx.insert(workItems)
      .values({
        id: workItemId,
        name,
        repoId: repo.id,
        repoPath: checkout.path,
        repoAlias: repo.alias,
        branchName: checkout.branch,
        status: 'active',
        provisionStatus: 'ready',
        agentProvider,
        ownerAccountId: user?.userId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(workItemWorktrees)
      .values({
        id: worktreeId,
        workItemId,
        path: checkout.path,
        branchName: checkout.branch,
        baseBranch: null,
        targetRef: target.data,
        forkSha: null,
        forkSource: null,
        slug: path.basename(checkout.path),
        branchOrigin: 'user',
        checkoutOrigin: 'adopted',
        setupStatus: 'skipped',
        isPrimary: 1,
        title: null,
        createdAt: now,
      })
      .run();
  });
  log.info('[worktree-sources] adopted a checkout', {
    workItemId,
    worktreeId,
    path: checkout.path,
    branch: checkout.branch,
  });

  await enqueueCloudCreate(workItemId, checkout.path);
  scheduleWorktreeCloudSync(workItemId);
  const sessions = await importTickedSessions(args, workItemId, worktreeId);
  return ok({ workItemId, worktreeId, ...sessions });
}
