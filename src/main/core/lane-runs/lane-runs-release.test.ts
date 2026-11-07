import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRunning } from './_testing/run-process';

/**
 * A lane's checkout is never removed under a running process: deleting the
 * lane stops its runs and its test first (awaited), then runs its teardown —
 * as its own shell-line process, which exits on its own on Windows too
 * (it used to be typed into a shell as `<script>; exit`, which cmd.exe does
 * not split, so every Windows teardown sat out the 10 s timeout). Real
 * repository, real lanes, the real delete path; Electron's keychain, the
 * database and the IPC emitter are the substitutes the other worktree
 * suites use.
 */
vi.mock('electron', () => import('@main/core/account/_testing/test-keychain-electron'));
vi.mock('@main/db/client', () => import('@main/db/_testing/test-db-client'));
vi.mock('@main/lib/events', () => ({
  events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
}));

const fixture = await import('./_testing/lane-run-fixture');
const { tearDownLaneRepo } = await import('./_testing/lane-run-suite');
const { acquireWorktreeWorkspace } = await import('@main/core/worktrees/workspace-bridge');
const { deleteWorktree } = await import('@main/core/worktrees/delete-worktree');
const { readLaneRunState } = await import('./lane-run-registry');
const { runLaneTest, startLaneRun } = await import('./start-lane-run');

const ITEM_ID = 'item-1';
const PRIMARY_ID = 'lane-primary';
const SECONDARY_ID = 'lane-secondary';

describe('deleting a lane with runs', () => {
  let repo: Awaited<ReturnType<typeof fixture.createLaneRepo>>;
  let secondaryPath: string;
  let teardownMarker: string;

  beforeEach(async () => {
    repo = await fixture.createLaneRepo('lane-runs-release-');
    teardownMarker = path.join(repo.root, 'teardown-ran.txt').replace(/\\/g, '/');
    await fixture.commitTeamConfig(repo.repoDir, {
      scripts: {
        run: { web: 'node scripts/serve.cjs' },
        test: 'node scripts/stubborn.cjs',
        // Outside the checkout, which is gone by the time the suite looks.
        teardown: `node -e "require('fs').writeFileSync('${teardownMarker}', process.env.CHORD_LANE_ID)"`,
      },
    });
    fixture.insertRepoAndItems(repo.repoDir, [ITEM_ID]);
    await fixture.addLane({ repo, laneId: PRIMARY_ID, workItemId: ITEM_ID, dir: 'primary' });
    secondaryPath = await fixture.addLane({
      repo,
      laneId: SECONDARY_ID,
      workItemId: ITEM_ID,
      dir: 'secondary',
      isPrimary: false,
    });
    await fixture.approveLaneAsIs(SECONDARY_ID);
  });

  afterEach(() => tearDownLaneRepo(repo, [SECONDARY_ID]));

  it('stops its runs and test first, then runs its teardown to its own exit, then removes the checkout', async () => {
    await acquireWorktreeWorkspace(fixture.readLaneRow(SECONDARY_ID));
    await startLaneRun({ laneId: SECONDARY_ID, scriptId: 'web' }, fixture.neverAsk);
    await runLaneTest({ laneId: SECONDARY_ID }, fixture.neverAsk);
    const web = await fixture.waitForRunProcess(path.join(secondaryPath, 'serve.pid'));
    const test = await fixture.waitForRunProcess(path.join(secondaryPath, 'stubborn.pid'));

    const result = await deleteWorktree(SECONDARY_ID);

    expect(result).toEqual({ success: true, data: { workItemId: ITEM_ID } });
    expect(await isRunning(web)).toBe(false);
    expect(await isRunning(test)).toBe(false);
    expect(fs.existsSync(secondaryPath)).toBe(false);
    expect(fs.readFileSync(teardownMarker, 'utf8')).toBe(SECONDARY_ID);
    expect(readLaneRunState(SECONDARY_ID).scripts).toEqual({});
  });

  it('runs the teardown without waiting out the timeout', async () => {
    await acquireWorktreeWorkspace(fixture.readLaneRow(SECONDARY_ID));

    const t0 = Date.now();
    const result = await deleteWorktree(SECONDARY_ID);

    expect(result.success).toBe(true);
    expect(fs.readFileSync(teardownMarker, 'utf8')).toBe(SECONDARY_ID);
    // The teardown's wait is 10 s; a teardown that exits on its own is done well before.
    expect(Date.now() - t0).toBeLessThan(8_000);
  });
});
