import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  copyGitRemoteFixture,
  createGitRemoteTemplate,
  git,
  removeGitFixture,
} from '@main/core/git/_testing/git-remote-fixture';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { preflightLaneRequest } from './lane-preflight';

async function worktreeCount(repoDir: string): Promise<number> {
  const out = await git(['worktree', 'list', '--porcelain'], repoDir);
  return out.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

/**
 * The checks `createWorkItem` runs before it writes anything: every failure
 * here must reach the create dialog, with nothing created and nothing changed
 * in the user's checkout.
 */
describe('preflightLaneRequest', () => {
  let root: string;
  let remoteDir: string;
  let repoDir: string;
  let teammateRepo: string;

  let template: string;

  beforeAll(async () => {
    template = await createGitRemoteTemplate();
  });

  afterAll(() => {
    removeGitFixture(template);
  });

  beforeEach(() => {
    const fixture = copyGitRemoteFixture(template, 'lane-preflight-');
    root = fixture.root;
    remoteDir = fixture.remoteDir;
    repoDir = fixture.cloneDir;
    teammateRepo = fixture.pusherDir;
  });

  afterEach(() => {
    removeGitFixture(root);
  });

  async function pushTeammateBranch(branch: string): Promise<void> {
    await git(['switch', '-c', branch], teammateRepo);
    await git(['commit', '--allow-empty', '-m', `${branch} work`], teammateRepo);
    await git(['push', 'origin', branch], teammateRepo);
    await git(['switch', 'main'], teammateRepo);
  }

  describe('an existing branch', () => {
    it('is refused when the main checkout has it, naming that checkout', async () => {
      await git(['switch', '-c', 'feat/root-check'], repoDir);

      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'existing', branchName: 'feat/root-check' },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toMatchObject({
        type: 'branch_checked_out',
        branch: 'feat/root-check',
        path: path.resolve(repoDir),
      });
      expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir)).toBe('feat/root-check');
      expect(await worktreeCount(repoDir)).toBe(1);
    });

    it('is refused when another lane has it checked out', async () => {
      await git(['branch', 'feat/busy'], repoDir);
      const lane = path.join(root, 'pool', 'busy');
      await git(['worktree', 'add', lane, 'feat/busy'], repoDir);

      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'existing', branchName: 'feat/busy' },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toMatchObject({ type: 'branch_checked_out', path: path.resolve(lane) });
    });

    it('passes when it exists locally and nothing has it checked out', async () => {
      await git(['branch', 'feat/free'], repoDir);

      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'existing', branchName: 'feat/free' },
      });

      expect(result).toEqual({ success: true, data: undefined });
    });

    it('passes for a branch only the remote has, fetching it so provisioning can check it out', async () => {
      await pushTeammateBranch('feat/teammate');

      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'existing', branchName: 'feat/teammate' },
      });

      expect(result.success).toBe(true);
      expect(await git(['rev-parse', 'origin/feat/teammate'], repoDir)).toBe(
        await git(['rev-parse', 'feat/teammate'], teammateRepo)
      );
    });

    it('is reported missing when neither this clone nor the remote has it', async () => {
      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'existing', branchName: 'feat/nowhere' },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toMatchObject({ type: 'branch_not_found', branch: 'feat/nowhere' });
    });
  });

  describe('a base for a new branch', () => {
    it('passes with no base asked for — the default is resolved while provisioning', async () => {
      const result = await preflightLaneRequest({ repoPath: repoDir, request: { kind: 'new' } });

      expect(result.success).toBe(true);
    });

    it('passes for a base this clone already tracks, in either spelling', async () => {
      for (const baseRef of ['main', 'origin/main']) {
        const result = await preflightLaneRequest({
          repoPath: repoDir,
          request: { kind: 'new', baseRef },
        });
        expect(result.success).toBe(true);
      }
    });

    it('passes for a base only the remote has, and fetches it', async () => {
      await pushTeammateBranch('release/2.0');

      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'new', baseRef: 'release/2.0' },
      });

      expect(result.success).toBe(true);
      expect(await git(['rev-parse', 'origin/release/2.0'], repoDir)).toBe(
        await git(['rev-parse', 'release/2.0'], teammateRepo)
      );
    });

    it('is reported missing when neither this clone nor the remote has it', async () => {
      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'new', baseRef: 'no-such-branch' },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toMatchObject({ type: 'base_not_found', ref: 'no-such-branch' });
    });

    it('says the fetch failed, rather than that the base is missing, when the remote is unreachable', async () => {
      removeDirSync(remoteDir);

      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'new', baseRef: 'release/2.0' },
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toMatchObject({ type: 'fetch_failed', ref: 'release/2.0' });
      if (result.error.type !== 'fetch_failed') return;
      // devstation-kcvy: the dialog's sentence, with git's own words apart.
      expect(result.error.message).toBe('Could not ask the remote for release/2.0.');
      expect(result.error.gitOutput).toMatch(/^fatal: /);
      expect(result.error.gitOutput).not.toMatch(/Command failed/);
    });

    it('needs no network for a base this clone already knows', async () => {
      removeDirSync(remoteDir);

      const result = await preflightLaneRequest({
        repoPath: repoDir,
        request: { kind: 'new', baseRef: 'main' },
      });

      expect(result.success).toBe(true);
    });
  });
});
