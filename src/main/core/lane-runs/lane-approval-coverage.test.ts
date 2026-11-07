import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A lane's approval covers what was approved and anything that runs less of
 * it (devstation-5b3.5). The user replacing the team's test with their own
 * (just me) drops the team's test out of what the lane would run; the rest —
 * the team's run scripts, its teardown — is still what was approved, so it
 * runs without asking, at Start and at delete. A changed team script still
 * asks. Real repository, real lanes, the real delete path; Electron's
 * keychain, the database and the IPC emitter are the substitutes the other
 * worktree suites use.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});
vi.mock('@main/lib/events', () => ({
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
}));

const fixture = await import('./_testing/lane-run-fixture');
const { db } = await import('@main/db/client');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { recordRepoApproval } = await import('@main/core/workspaces/script-approval');
const { acquireWorktreeWorkspace } = await import('@main/core/worktrees/workspace-bridge');
const { deleteWorktree } = await import('@main/core/worktrees/delete-worktree');
const { resolveLaneBundle } = await import('@main/core/worktrees/lane-bundle');
const { resolveApprovedLaneScripts } = await import('@main/core/worktrees/lane-config');
const { approveBundleForLane } = await import('@main/core/worktrees/lane-run-approval');
const { readLaneRunState, releaseLaneRuns } = await import('./lane-run-registry');
const { startLaneRun } = await import('./start-lane-run');

const ITEM_ID = 'item-1';
const PRIMARY_ID = 'lane-primary';
const SECONDARY_ID = 'lane-secondary';
const OWN_TEST = 'node scripts/exit.cjs 0';

describe("a lane's approval after the user's own script replaces one of the team's", () => {
  let repo: Awaited<ReturnType<typeof fixture.createLaneRepo>>;
  let teardownMarker: string;
  let teardown: string;

  async function questionFor(laneId: string) {
    const lane = await resolveLaneBundle(laneId);
    return {
      laneId,
      repoId: lane.repoId,
      repoPath: lane.sourcePath,
      ref: lane.targetRef,
      remoteUrl: lane.remoteUrl,
      claudeSource: lane.claudeSource,
      bundle: lane.bundle,
    };
  }

  beforeEach(async () => {
    repo = await fixture.createLaneRepo('lane-approval-coverage-');
    teardownMarker = path.join(repo.root, 'teardown-ran.txt').replace(/\\/g, '/');
    // Outside the checkout, which is gone by the time the suite looks.
    teardown = `node -e "require('fs').writeFileSync('${teardownMarker}', process.env.CHORD_LANE_ID)"`;
    await fixture.commitTeamConfig(repo.repoDir, {
      scripts: {
        setup: 'node scripts/exit.cjs 0',
        run: { env: 'node scripts/env.cjs' },
        test: 'node scripts/exit.cjs 1',
        teardown,
      },
    });
    fixture.insertRepoAndItems(repo.repoDir, [ITEM_ID]);
    await fixture.addLane({ repo, laneId: PRIMARY_ID, workItemId: ITEM_ID, dir: 'primary' });
    await fixture.addLane({
      repo,
      laneId: SECONDARY_ID,
      workItemId: ITEM_ID,
      dir: 'secondary',
      isPrimary: false,
    });
  });

  afterEach(async () => {
    await releaseLaneRuns(SECONDARY_ID);
    await releaseLaneRuns(PRIMARY_ID);
    db.delete(workItems).run();
    db.delete(repos).run();
    await fixture.removeLaneRepo(repo);
  });

  describe('approved for the lane', () => {
    beforeEach(async () => {
      await fixture.approveLaneAsIs(SECONDARY_ID);
      fixture.setJustMeScripts({ test: OWN_TEST });
    });

    it("keeps the team's run scripts and teardown, beside the user's own test", async () => {
      await expect(resolveApprovedLaneScripts(SECONDARY_ID)).resolves.toEqual({
        run: { env: 'node scripts/env.cjs' },
        test: OWN_TEST,
        teardown,
      });
      await expect(
        approveBundleForLane(await questionFor(SECONDARY_ID), fixture.neverAsk)
      ).resolves.toBe(true);
    });

    it("starts the team's run script without asking", async () => {
      const started = await startLaneRun(
        { laneId: SECONDARY_ID, scriptId: 'env' },
        fixture.neverAsk
      );

      expect(started.success).toBe(true);
      await vi.waitFor(
        () => expect(readLaneRunState(SECONDARY_ID).scripts.env?.status).toBe('exited'),
        { timeout: 15_000 }
      );
    });

    it("runs the team's teardown when the lane is deleted, without asking", async () => {
      await acquireWorktreeWorkspace(fixture.readLaneRow(SECONDARY_ID));

      const result = await deleteWorktree(SECONDARY_ID);

      expect(result).toEqual({ success: true, data: { workItemId: ITEM_ID } });
      expect(fs.readFileSync(teardownMarker, 'utf8')).toBe(SECONDARY_ID);
    });

    it('still asks about a team teardown changed after the approval, and runs neither', async () => {
      await fixture.commitTeamConfig(repo.repoDir, {
        scripts: {
          setup: 'node scripts/exit.cjs 0',
          run: { env: 'node scripts/env.cjs' },
          test: 'node scripts/exit.cjs 1',
          teardown: `${teardown} && node scripts/exit.cjs 0`,
        },
      });

      await expect(resolveApprovedLaneScripts(SECONDARY_ID)).resolves.toEqual({
        run: {},
        test: OWN_TEST,
      });
      const { ask, asked } = fixture.answer('dont-run');
      await expect(approveBundleForLane(await questionFor(SECONDARY_ID), ask)).resolves.toBe(false);
      expect(asked).toHaveLength(1);
      expect(asked[0]?.bundle.content.chord.teardown).toBe(
        `${teardown} && node scripts/exit.cjs 0`
      );
    });
  });

  it("keeps Always trust for every lane after the user's own test replaces the team's", async () => {
    const before = await questionFor(PRIMARY_ID);
    if (!before.bundle) throw new Error('nothing to approve');
    fixture.setJustMeScripts({ test: OWN_TEST });
    recordRepoApproval({
      repoId: fixture.REPO_ID,
      hash: before.bundle.hash,
      content: before.bundle.content,
      remoteUrl: before.remoteUrl,
    });

    for (const laneId of [PRIMARY_ID, SECONDARY_ID]) {
      await expect(approveBundleForLane(await questionFor(laneId), fixture.neverAsk)).resolves.toBe(
        true
      );
      await expect(resolveApprovedLaneScripts(laneId)).resolves.toEqual({
        run: { env: 'node scripts/env.cjs' },
        test: OWN_TEST,
        teardown,
      });
    }
  });
});
