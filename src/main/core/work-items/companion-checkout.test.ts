import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  copyGitRemoteFixture,
  createGitRemoteTemplate,
  git,
  removeGitFixture,
} from '@main/core/git/_testing/git-remote-fixture';
import {
  companionRepoSchema,
  provisionCompanionCheckout,
  removeCompanionCheckout,
  type CompanionRepo,
} from './companion-checkout';

/**
 * Real repositories: the fixture's clone is the companion (it ignores `app/`),
 * the fixture's pusher stands for the repository whose lane nests inside it.
 */
describe('companion checkouts', () => {
  let template: string;
  let root: string;
  let companion: CompanionRepo;
  let appRepo: string;
  let pool: string;

  beforeAll(async () => {
    template = await createGitRemoteTemplate();
  });
  afterAll(() => removeGitFixture(template));

  beforeEach(async () => {
    const fixture = copyGitRemoteFixture(template, 'companion-checkout-');
    root = fixture.root;
    appRepo = fixture.pusherDir;
    pool = path.join(root, 'pool');
    companion = { path: fixture.cloneDir, appFolder: 'app' };
    fs.writeFileSync(path.join(fixture.cloneDir, '.gitignore'), '/app/\n');
    await git(['add', '.gitignore'], fixture.cloneDir);
    await git(['commit', '-m', 'ignore the app'], fixture.cloneDir);
  });
  afterEach(() => removeGitFixture(root));

  const provision = (laneBranch = 'feat/login') =>
    provisionCompanionCheckout({ companion, poolPath: pool, slug: 'login', laneBranch });

  it('creates the companion worktree, nests a lane checkout cleanly, and removes it after the lane', async () => {
    const made = await provision();
    expect(made.success).toBe(true);
    if (!made.success) return;
    const { companionPath, companionBranch, appPath } = made.data;
    expect(companionPath).toBe(path.join(pool, 'login'));
    expect(appPath).toBe(path.join(pool, 'login', 'app'));
    expect(companionBranch).toBe('companion/feat/login');
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], companionPath)).toBe(
      'companion/feat/login'
    );
    expect(await git(['rev-parse', 'HEAD'], companionPath)).toBe(
      await git(['rev-parse', 'HEAD'], companion.path)
    );

    // The lane's own checkout at appPath leaves the companion clean.
    await git(['worktree', 'add', '-b', 'feat/login', appPath], appRepo);
    expect(await git(['status', '--porcelain'], companionPath)).toBe('');

    const early = await removeCompanionCheckout({ companion, companionPath });
    expect(early).toMatchObject({
      success: false,
      error: { type: 'lane_checkout_present', path: appPath },
    });
    expect(fs.existsSync(companionPath)).toBe(true);

    await git(['worktree', 'remove', appPath], appRepo);
    expect(await removeCompanionCheckout({ companion, companionPath })).toEqual({
      success: true,
      data: undefined,
    });
    expect(fs.existsSync(companionPath)).toBe(false);
    // The branch stays, as a lane's does.
    expect(await git(['branch', '--list', 'companion/feat/login'], companion.path)).toContain(
      'companion/feat/login'
    );
  });

  it('refuses a companion that does not ignore the app folder, creating nothing', async () => {
    fs.writeFileSync(path.join(companion.path, '.gitignore'), '');
    await git(['commit', '-am', 'stop ignoring'], companion.path);
    const made = await provision();
    expect(made).toMatchObject({ success: false, error: { type: 'app_folder_not_ignored' } });
    expect(fs.existsSync(path.join(pool, 'login'))).toBe(false);
    expect(await git(['branch', '--list', 'companion/*'], companion.path)).toBe('');
  });

  it('refuses a detached companion, a taken branch or folder, and a folder that is not a main checkout', async () => {
    await git(['branch', 'companion/feat/login'], companion.path);
    expect(await provision()).toMatchObject({
      success: false,
      error: { type: 'branch_exists', branch: 'companion/feat/login' },
    });

    fs.mkdirSync(path.join(pool, 'login'), { recursive: true });
    expect(await provision('feat/other')).toMatchObject({
      success: false,
      error: { type: 'path_exists' },
    });

    const notMain = await provisionCompanionCheckout({
      companion: { path: pool, appFolder: 'app' },
      poolPath: path.join(root, 'pool-2'),
      slug: 'x',
      laneBranch: 'feat/x',
    });
    expect(notMain).toMatchObject({ success: false, error: { type: 'not_a_main_checkout' } });

    await git(['checkout', '--detach'], companion.path);
    expect(await provision('feat/third')).toMatchObject({
      success: false,
      error: { type: 'detached_head' },
    });
  });

  it('keeps a companion checkout that has changes', async () => {
    const made = await provision();
    if (!made.success) throw new Error(made.error.message);
    fs.writeFileSync(path.join(made.data.companionPath, 'notes.md'), 'work in progress\n');
    const removed = await removeCompanionCheckout({
      companion,
      companionPath: made.data.companionPath,
    });
    expect(removed).toMatchObject({ success: false, error: { type: 'companion_has_changes' } });
    expect(fs.readFileSync(path.join(made.data.companionPath, 'notes.md'), 'utf8')).toBe(
      'work in progress\n'
    );
  });

  // Review P3: `git worktree remove` deletes ignored files, which plain `status --porcelain` hides.
  it('keeps a companion checkout that holds ignored files', async () => {
    fs.appendFileSync(path.join(companion.path, '.git', 'info', 'exclude'), '.env\n');
    const made = await provision();
    if (!made.success) throw new Error(made.error.message);
    const env = path.join(made.data.companionPath, '.env');
    fs.writeFileSync(env, 'TOKEN=local\n');
    expect(await git(['status', '--porcelain'], made.data.companionPath)).toBe('');
    const removed = await removeCompanionCheckout({
      companion,
      companionPath: made.data.companionPath,
    });
    expect(removed).toMatchObject({
      success: false,
      error: { type: 'companion_has_changes', message: expect.stringContaining('.env') },
    });
    expect(fs.readFileSync(env, 'utf8')).toBe('TOKEN=local\n');
  });

  // Review round 2: trimming the porcelain output cut the leading space of ' M x', so the first
  // path lost its first character and a one-character name vanished from the check.
  it('keeps a companion checkout whose only change is a one-character tracked file', async () => {
    fs.writeFileSync(path.join(companion.path, 'x'), 'one\n');
    await git(['add', 'x'], companion.path);
    await git(['commit', '-m', 'x'], companion.path);
    const made = await provision();
    if (!made.success) throw new Error(made.error.message);
    fs.writeFileSync(path.join(made.data.companionPath, 'x'), 'two\n');
    const removed = await removeCompanionCheckout({
      companion,
      companionPath: made.data.companionPath,
    });
    expect(removed).toMatchObject({
      success: false,
      error: { type: 'companion_has_changes', message: expect.stringContaining('(x)') },
    });
    expect(fs.readFileSync(path.join(made.data.companionPath, 'x'), 'utf8')).toBe('two\n');
  });

  it('the setting takes an absolute companion path and a folder inside it', () => {
    const abs = path.resolve('companion');
    expect(companionRepoSchema.safeParse({ path: abs, appFolder: 'app' }).success).toBe(true);
    expect(companionRepoSchema.safeParse({ path: abs, appFolder: 'apps/web' }).success).toBe(true);
    expect(companionRepoSchema.safeParse({ path: 'relative', appFolder: 'app' }).success).toBe(
      false
    );
    expect(companionRepoSchema.safeParse({ path: abs, appFolder: '../app' }).success).toBe(false);
    expect(companionRepoSchema.safeParse({ path: abs, appFolder: abs }).success).toBe(false);
    expect(companionRepoSchema.safeParse({ path: abs, appFolder: '' }).success).toBe(false);
    expect(companionRepoSchema.safeParse({ path: abs, appFolder: 'app', extra: 1 }).success).toBe(
      false
    );
  });
});
