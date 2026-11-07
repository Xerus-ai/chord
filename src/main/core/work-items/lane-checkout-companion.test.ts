import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  copyGitRemoteFixture,
  createGitRemoteTemplate,
  git,
  removeGitFixture,
} from '@main/core/git/_testing/git-remote-fixture';
import type { CompanionRepo } from './companion-checkout';
import { provisionLaneCheckout } from './lane-checkout';

/**
 * devstation-4x42.242: a lane of a repository with a companion is created as
 * the pair, the companion's worktree first and the lane's checkout nested in
 * it, and a failure leaves neither. Real repositories: the fixture's clone is
 * the repository, its pusher the companion (which ignores `app/`).
 */
describe('provisionLaneCheckout with a companion repository', () => {
  let template: string;
  let root: string;
  let repoDir: string;
  let pool: string;
  let companion: CompanionRepo;

  beforeAll(async () => {
    template = await createGitRemoteTemplate();
  });
  afterAll(() => removeGitFixture(template));

  beforeEach(async () => {
    const fixture = copyGitRemoteFixture(template, 'lane-companion-');
    root = fixture.root;
    repoDir = fixture.cloneDir;
    pool = path.join(root, 'pool');
    companion = { path: fixture.pusherDir, appFolder: 'app' };
    fs.writeFileSync(path.join(companion.path, '.gitignore'), '/app/\n');
    await git(['add', '.gitignore'], companion.path);
    await git(['commit', '-m', 'ignore the app'], companion.path);
  });
  afterEach(() => removeGitFixture(root));

  const companionBranches = () => git(['branch', '--list', 'companion/*'], companion.path);

  it('nests the lane checkout in the companion worktree at <pool>/<slug>', async () => {
    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: pool,
      request: { kind: 'new', branchName: 'chord/fix-login-a1b' },
      companion,
    });
    if (!result.success) throw new Error(result.error.message);
    const companionPath = path.join(pool, 'fix-login-a1b');
    expect(result.data).toMatchObject({
      slug: 'fix-login-a1b',
      worktreePath: path.join(companionPath, 'app'),
      companionPath,
      companionRepoPath: companion.path,
    });
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], companionPath)).toBe(
      'companion/chord/fix-login-a1b'
    );
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], result.data.worktreePath)).toBe(
      'chord/fix-login-a1b'
    );
    expect(await git(['status', '--porcelain'], companionPath)).toBe('');
  });

  it('records no companion for a repository without one', async () => {
    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: pool,
      request: { kind: 'new', branchName: 'chord/plain' },
    });
    if (!result.success) throw new Error(result.error.message);
    expect(result.data).toMatchObject({
      worktreePath: path.join(pool, 'plain'),
      companionPath: null,
      companionRepoPath: null,
    });
  });

  it('removes the companion half, and the branch it made, when the lane checkout fails', async () => {
    // `main` is checked out in the repository itself, so its lane is refused.
    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: pool,
      request: { kind: 'existing', branchName: 'main' },
      companion,
    });
    expect(result).toMatchObject({ success: false, error: { type: 'branch_checked_out' } });
    expect(fs.existsSync(pool) ? fs.readdirSync(pool) : []).toEqual([]);
    expect(await companionBranches()).toBe('');
    expect(await git(['worktree', 'list', '--porcelain'], companion.path)).not.toContain(pool);
  });

  it('refuses a companion that does not ignore the app folder, before any checkout', async () => {
    fs.writeFileSync(path.join(companion.path, '.gitignore'), '');
    await git(['commit', '-am', 'stop ignoring'], companion.path);
    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: pool,
      request: { kind: 'new', branchName: 'chord/x' },
      companion,
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'worktree_failed', message: expect.stringContaining('Companion repository') },
    });
    expect(await git(['branch', '--list', 'chord/x'], repoDir)).toBe('');
  });

  it('resumes an interrupted create from its companion half alone, or from the whole pair', async () => {
    // Chord died after the companion worktree was made, before the lane's checkout.
    const companionPath = path.join(pool, 'resume-a1b');
    await git(
      ['worktree', 'add', '-b', 'companion/chord/resume-a1b', companionPath],
      companion.path
    );
    const halfway = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: pool,
      request: { kind: 'new', branchName: 'chord/resume-a1b' },
      companion,
      resumeInterrupted: true,
    });
    if (!halfway.success) throw new Error(halfway.error.message);
    expect(halfway.data.worktreePath).toBe(path.join(companionPath, 'app'));
    expect(halfway.data.companionPath).toBe(companionPath);
    expect(fs.readdirSync(pool)).toEqual(['resume-a1b']);

    // Retried again with both halves there: both are taken over as they are.
    const whole = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: pool,
      request: { kind: 'new', branchName: 'chord/resume-a1b' },
      companion,
      resumeInterrupted: true,
    });
    if (!whole.success) throw new Error(whole.error.message);
    expect(whole.data).toMatchObject({
      worktreePath: path.join(companionPath, 'app'),
      slug: 'resume-a1b',
      companionPath,
    });
    expect(fs.readdirSync(pool)).toEqual(['resume-a1b']);
  });

  it('never takes over a pool checkout of its branch that is not nested in its companion', async () => {
    await git(['worktree', 'add', '-b', 'chord/stray-a1b', path.join(pool, 'stray-a1b')], repoDir);
    const result = await provisionLaneCheckout({
      repoPath: repoDir,
      poolPath: pool,
      request: { kind: 'new', branchName: 'chord/stray-a1b' },
      companion,
      resumeInterrupted: true,
    });
    expect(result).toMatchObject({ success: false, error: { type: 'branch_checked_out' } });
    expect(await companionBranches()).toBe('');
  });
});
