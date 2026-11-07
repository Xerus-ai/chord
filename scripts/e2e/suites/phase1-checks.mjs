/**
 * The nine Phase 1 checks of plan 2026-09-26 (worktrees/repos/settings v1),
 * live on the current build (devstation-cz3a):
 *   1. typing `main` creates a new lane `main-…`, nothing claims to reuse it;
 *   2. a branch checked out in the root or another lane → typed error, nothing created;
 *   3. a base or branch that does not exist → typed error (in the dialog, which stays open);
 *   4. offline create offers "Create from local copy" and records `fork_source`;
 *   5. deleting a failed work item never touches the repository checkout;
 *   6. a new lane forks from the fetched origin/HEAD and records `fork_sha`;
 *   7. the agent edits `.chord.json` in a lane; the next setup runs the trusted script;
 *   8. two chats in one item survive a restart, each resuming its own conversation;
 *   9. a failing setup shows its log and Retry, and the agent's first turn waits.
 *  Plus the follow-ups found on its first runs: a held prompt counts on its
 *  chat (w50w), untitled chats take their first message (d8lx), a failed
 *  checkout is named as one (dd6x).
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-history node scripts/e2e/suites/phase1-checks.mjs
 *
 * Two scratch repositories (a bare origin plus a clone each) under the OS temp
 * folder; check 8 uses Codex. The run's work items are deleted in the app and
 * the suite waits until the cloud no longer has them. Screenshots:
 * screenshots/e2e/phase1-*.png.
 */
import { rmSync } from 'node:fs';
import {
  checkCheckedOutBranchRefused,
  checkMissingBaseRefused,
  checkOfflineCreateAndDelete,
  checkTypedMainForksFetchedBase,
} from '../lib/phase1/create-checks.mjs';
import { createResults, createScratchRepo } from '../lib/phase1/phase1-support.mjs';
import { checkTwoChatsSurviveRestart } from '../lib/phase1/restart-check.mjs';
import {
  checkEditedConfigRunsTrustedScript,
  checkFailingSetupHoldsFirstTurn,
  setupRepoConfig,
} from '../lib/phase1/setup-checks.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';

const SEED_PROFILE = process.env.CHORD_E2E_PROFILE ?? 'chord-p1-smoke';

const r = createResults();
await assertServerHealthy();
const plain = createScratchRepo('phase1');
const withSetup = createScratchRepo('phase1-setup', setupRepoConfig);
const account = await launchAccount({ seedProfile: SEED_PROFILE, label: 'phase1' });
const ctx = { r, account, page: account.instance.page, created: [] };
try {
  for (const repo of [plain, withSetup]) {
    repo.alias = repo === plain ? 'phase1' : 'phase1-setup';
    const { repo: row } = await ctx.account.call('repos.create', {
      path: repo.root,
      alias: repo.alias,
    });
    repo.repoId = row.id;
  }
  const mainLane = await checkTypedMainForksFetchedBase(ctx, plain);
  await checkCheckedOutBranchRefused(ctx, plain, mainLane);
  await checkMissingBaseRefused(ctx, plain);
  await checkOfflineCreateAndDelete(ctx, plain);
  const { lane } = await checkFailingSetupHoldsFirstTurn(ctx, withSetup);
  await checkEditedConfigRunsTrustedScript(ctx, withSetup, lane);
  await checkTwoChatsSurviveRestart(ctx, plain, SEED_PROFILE);
} catch (error) {
  await ctx.page.screenshot({ path: r.shot('failure') });
  throw error;
} finally {
  for (const workItemId of ctx.created) {
    await ctx.account.call('workItems.remove', workItemId);
    await waitFor(
      async () => (await ctx.account.api('GET', `/work-items/${workItemId}`)).status === 404,
      60_000,
      'the cloud to drop the run’s work item'
    );
  }
  await ctx.account.close();
  for (const repo of [plain, withSetup]) {
    rmSync(repo.scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const failed = r.results.filter((result) => !result.ok);
console.log(`\n${r.results.length - failed.length}/${r.results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
