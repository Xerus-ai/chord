import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { selectPreferredRemote } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { findBranchCheckout } from './find-branch-checkout';
import type { WorktreeHost } from './hosts/worktree-host';

export type WorktreeCheckoutError =
  | { type: 'branch-checked-out'; branch: string; path: string }
  | { type: 'branch-exists'; branch: string }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'path-exists'; path: string }
  | { type: 'worktree-setup-failed'; cause: unknown };

/**
 * The `git worktree` engine: one checkout per lane at `<pool>/<slug>`.
 *
 * A branch can be checked out in one place only — including the repository's
 * own main checkout. Handing back an existing checkout instead of refusing is
 * how an agent once ended up running in the user's repository root, so every
 * checkout here is new, or the call fails with the path that already holds it.
 *
 * Git operations on one repository are serialized: two concurrent `worktree
 * add` calls race on `.git/worktrees` and the branch refs.
 */
export class WorktreeService {
  private gitOpQueue: Promise<unknown> = Promise.resolve();
  private readonly worktreePoolPath: string;
  private readonly repoPath: string;
  private readonly ctx: IExecutionContext;
  private readonly host: WorktreeHost;

  constructor(args: {
    worktreePoolPath: string;
    repoPath: string;
    ctx: IExecutionContext;
    host: WorktreeHost;
  }) {
    this.worktreePoolPath = args.worktreePoolPath;
    this.repoPath = args.repoPath;
    this.ctx = args.ctx;
    this.host = args.host;
  }

  private enqueueGitOp<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.gitOpQueue.then(fn, fn);
    this.gitOpQueue = result.catch(() => {});
    return result as Promise<T>;
  }

  private git(args: string[]): Promise<string> {
    return this.ctx.exec(GIT_EXECUTABLE, args).then((r) => r.stdout.trim());
  }

  private async refExists(ref: string): Promise<boolean> {
    return this.git(['rev-parse', '--verify', '--quiet', ref]).then(
      () => true,
      () => false
    );
  }

  private async prepareTarget(slug: string): Promise<Result<string, WorktreeCheckoutError>> {
    const targetPath = path.join(this.worktreePoolPath, slug);
    try {
      await this.host.mkdirAbsolute(this.worktreePoolPath, { recursive: true });
    } catch (cause) {
      return err({ type: 'worktree-setup-failed', cause });
    }
    const exists = this.ctx.supportsLocalSpawn
      ? await fsPromises.access(targetPath).then(
          () => true,
          () => false
        )
      : await this.host.existsAbsolute(targetPath);
    if (exists) return err({ type: 'path-exists', path: targetPath });
    // Registrations left by checkouts deleted outside git would otherwise make
    // git think the branch is still checked out there.
    await this.git(['worktree', 'prune']);
    return ok(targetPath);
  }

  /** A new branch at `startPoint`, checked out at `<pool>/<slug>`. */
  checkoutNewBranch(args: {
    branchName: string;
    slug: string;
    startPoint: string;
  }): Promise<Result<string, WorktreeCheckoutError>> {
    return this.enqueueGitOp(() => this.doCheckoutNewBranch(args));
  }

  private async doCheckoutNewBranch(args: {
    branchName: string;
    slug: string;
    startPoint: string;
  }): Promise<Result<string, WorktreeCheckoutError>> {
    if (await this.refExists(`refs/heads/${args.branchName}`)) {
      return err({ type: 'branch-exists', branch: args.branchName });
    }
    const target = await this.prepareTarget(args.slug);
    if (!target.success) return target;

    try {
      await this.git([
        'worktree',
        'add',
        '--no-track',
        '-b',
        args.branchName,
        target.data,
        args.startPoint,
      ]);
    } catch (cause) {
      // `worktree add -b` can create the branch and then fail the checkout.
      // The branch was not there before this call, so it goes too.
      if (await this.refExists(`refs/heads/${args.branchName}`)) {
        await this.git(['branch', '-D', args.branchName]);
      }
      return err({ type: 'worktree-setup-failed', cause });
    }
    return ok(target.data);
  }

  /**
   * An existing branch — local, or tracked from the preferred remote — checked
   * out at `<pool>/<slug>`. Refuses a branch that is checked out anywhere.
   */
  checkoutExistingBranch(args: {
    branchName: string;
    slug: string;
  }): Promise<Result<string, WorktreeCheckoutError>> {
    return this.enqueueGitOp(() => this.doCheckoutExistingBranch(args));
  }

  private async doCheckoutExistingBranch(args: {
    branchName: string;
    slug: string;
  }): Promise<Result<string, WorktreeCheckoutError>> {
    await this.git(['worktree', 'prune']);
    const holder = await findBranchCheckout(this.ctx, args.branchName);
    if (holder) return err({ type: 'branch-checked-out', branch: args.branchName, path: holder });

    const createdTrackingBranch = !(await this.refExists(`refs/heads/${args.branchName}`));
    if (createdTrackingBranch) {
      const remotes = (await this.git(['remote'])).split('\n').filter(Boolean);
      if (remotes.length === 0) return err({ type: 'branch-not-found', branch: args.branchName });
      const remote = selectPreferredRemote(
        undefined,
        remotes.map((name) => ({ name, url: '' }))
      ).name;
      await this.git([
        'fetch',
        '--no-tags',
        remote,
        `+refs/heads/${args.branchName}:refs/remotes/${remote}/${args.branchName}`,
      ]).catch(() => undefined);
      if (!(await this.refExists(`refs/remotes/${remote}/${args.branchName}`))) {
        return err({ type: 'branch-not-found', branch: args.branchName });
      }
      await this.git(['branch', '--track', args.branchName, `${remote}/${args.branchName}`]);
    }

    const target = await this.prepareTarget(args.slug);
    if (!target.success) return target;
    try {
      await this.git(['worktree', 'add', target.data, args.branchName]);
    } catch (cause) {
      if (createdTrackingBranch) await this.git(['branch', '-D', args.branchName]);
      return err({ type: 'worktree-setup-failed', cause });
    }
    return ok(target.data);
  }

  /** Removes a checkout this service created, for rollback. Keeps the branch. */
  removeCheckout(checkoutPath: string): Promise<void> {
    return this.enqueueGitOp(async () => {
      await this.git(['worktree', 'remove', '--force', checkoutPath]);
      await this.git(['worktree', 'prune']);
    });
  }

  get repositoryPath(): string {
    return this.repoPath;
  }
}
