import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskScriptApproval } from '@main/core/workspaces/ask-script-approval';
import type { ExecutableBundle } from '@main/core/workspaces/executable-bundle';
import { recordLaneApproval } from '@main/core/workspaces/script-approval';
import { db } from '@main/db/client';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { approveBundleForLane } from './lane-run-approval';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const REPO = 'repo-1';
const LANE = 'lane-1';
const BUNDLE: ExecutableBundle = {
  hash: 'c'.repeat(64),
  content: { chord: { shellSetup: 'source .envrc' }, claude: {} },
};

function request(bundle: ExecutableBundle | null) {
  return {
    laneId: LANE,
    repoId: REPO,
    repoPath: '/repo',
    ref: 'main',
    remoteUrl: null,
    claudeSource: null,
    bundle,
  };
}

function counting(answer: 'run' | 'skip'): { ask: AskScriptApproval; calls: () => number } {
  let calls = 0;
  const ask: AskScriptApproval = async (req) => {
    calls += 1;
    if (answer === 'run') recordLaneApproval(req.laneId, req.bundle);
    await new Promise((r) => setTimeout(r, 10));
    return answer;
  };
  return { ask, calls: () => calls };
}

describe('approveBundleForLane', () => {
  beforeEach(() => {
    db.insert(repos).values({ id: REPO, path: '/repo', alias: 'repo' }).run();
    db.insert(workItems)
      .values({
        id: 'item-1',
        name: 'item',
        repoId: REPO,
        repoPath: '/repo',
        provisionStatus: 'ready',
      })
      .run();
    db.insert(workItemWorktrees)
      .values({ id: LANE, workItemId: 'item-1', path: '/lanes/1', isPrimary: 1, setupStatus: 'ok' })
      .run();
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
  });

  it('runs without asking when the repository supplies nothing that runs', async () => {
    const { ask, calls } = counting('skip');
    await expect(approveBundleForLane(request(null), ask)).resolves.toBe(true);
    expect(calls()).toBe(0);
  });

  it('runs without asking when this content is already approved', async () => {
    recordLaneApproval(LANE, BUNDLE);
    const { ask, calls } = counting('skip');
    await expect(approveBundleForLane(request(BUNDLE), ask)).resolves.toBe(true);
    expect(calls()).toBe(0);
  });

  it('asks, and runs after Run scripts', async () => {
    const { ask, calls } = counting('run');
    await expect(approveBundleForLane(request(BUNDLE), ask)).resolves.toBe(true);
    expect(calls()).toBe(1);
  });

  it("does not run after Don't run, and asks again next time", async () => {
    const { ask, calls } = counting('skip');
    await expect(approveBundleForLane(request(BUNDLE), ask)).resolves.toBe(false);
    await expect(approveBundleForLane(request(BUNDLE), ask)).resolves.toBe(false);
    expect(calls()).toBe(2);
  });

  it("remembers Don't run for callers that should not ask again, until the user asks to run it", async () => {
    const declined = counting('skip');
    await expect(approveBundleForLane(request(BUNDLE), declined.ask)).resolves.toBe(false);

    // An agent (re)start after Don't run: no new dialog.
    const restart = counting('run');
    await expect(
      approveBundleForLane(request(BUNDLE), restart.ask, { afterDecline: 'skip' })
    ).resolves.toBe(false);
    expect(restart.calls()).toBe(0);

    // Run setup asks again; once approved, every caller runs.
    const runSetup = counting('run');
    await expect(approveBundleForLane(request(BUNDLE), runSetup.ask)).resolves.toBe(true);
    expect(runSetup.calls()).toBe(1);
    await expect(
      approveBundleForLane(request(BUNDLE), counting('skip').ask, { afterDecline: 'skip' })
    ).resolves.toBe(true);
  });

  it("asks about changed content even after Don't run for the old content", async () => {
    await approveBundleForLane(request(BUNDLE), counting('skip').ask);

    const changed: ExecutableBundle = { ...BUNDLE, hash: 'd'.repeat(64) };
    const { ask, calls } = counting('run');
    await expect(
      approveBundleForLane(request(changed), ask, { afterDecline: 'skip' })
    ).resolves.toBe(true);
    expect(calls()).toBe(1);
  });

  it('shows one dialog to callers waiting on the same content at the same time', async () => {
    const { ask, calls } = counting('run');
    const answers = await Promise.all([
      approveBundleForLane(request(BUNDLE), ask),
      approveBundleForLane(request(BUNDLE), ask),
    ]);
    expect(answers).toEqual([true, true]);
    expect(calls()).toBe(1);
  });
});
