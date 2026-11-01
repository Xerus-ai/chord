import type {
  Branch,
  BranchPublication,
  Commit,
  CommitError,
  CommitFile,
  CreateBranchError,
  DeleteBranchError,
  DiffMode,
  DiffResult,
  FetchError,
  FetchPrForReviewError,
  FullGitStatus,
  GitChange,
  GitHeadState,
  GitInfo,
  GitObjectRef,
  MergeBaseRange,
  PullError,
  PushError,
  RenameBranchError,
  SoftResetError,
} from '@shared/git';
import type { Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { IDisposable } from '@main/lib/lifecycle';
import type { GitProvider } from '../types';
import { CatFileBatch } from './cat-file-batch';
import * as branchOps from './git-branch-ops';
import * as diffOps from './git-diff-ops';
import * as logOps from './git-log-ops';
import * as remoteOps from './git-remote-ops';
import * as repoOps from './git-repo-ops';
import * as statusOps from './git-status-ops';

export class GitService implements GitProvider, IDisposable {
  private _statusInFlight: Promise<FullGitStatus> | null = null;
  private _catFile: CatFileBatch | null = null;

  constructor(
    private readonly ctx: IExecutionContext,
    private readonly authCtx: IExecutionContext,
    private readonly fs: FileSystemProvider
  ) {}

  dispose(): void {
    this._catFile?.dispose();
    this._catFile = null;
  }

  private _getCatFile(): CatFileBatch | null {
    if (!this.ctx.supportsLocalSpawn) return null;
    this._catFile ??= new CatFileBatch(this.ctx.root ?? '');
    return this._catFile;
  }

  // --- Status ---

  async getFullStatus(): Promise<FullGitStatus> {
    if (this._statusInFlight) return this._statusInFlight;
    this._statusInFlight = statusOps
      .loadFullStatus(this.ctx, this.fs, () => this.getCurrentBranch())
      .finally(() => {
        this._statusInFlight = null;
      });
    return this._statusInFlight;
  }

  async getStatus(): Promise<{ changes: GitChange[]; currentBranch: string | null }> {
    return statusOps.getStatus(() => this.getFullStatus());
  }

  async listIgnoredPaths(): Promise<string[]> {
    return statusOps.listIgnoredPaths(this.ctx);
  }

  async getStagedChanges(): Promise<{
    changes: GitChange[];
    totalAdded: number;
    totalDeleted: number;
  }> {
    return statusOps.getStagedChanges(() => this.getFullStatus());
  }

  async getUnstagedChanges(): Promise<{ changes: GitChange[] }> {
    return statusOps.getUnstagedChanges(() => this.getFullStatus());
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    return statusOps.stageFiles(this.ctx, filePaths);
  }

  async stageAllFiles(): Promise<void> {
    return statusOps.stageAllFiles(this.ctx);
  }

  async unstageFiles(filePaths: string[]): Promise<void> {
    return statusOps.unstageFiles(this.ctx, filePaths);
  }

  async unstageAllFiles(): Promise<void> {
    return statusOps.unstageAllFiles(this.ctx);
  }

  async revertFiles(filePaths: string[]): Promise<void> {
    return statusOps.revertFiles(this.ctx, this.fs, filePaths);
  }

  async revertAllFiles(): Promise<void> {
    return statusOps.revertAllFiles(this.ctx);
  }

  // --- Diffs & log ---

  async getFileAtHead(filePath: string): Promise<string | null> {
    return diffOps.getFileAtRef(this.ctx, () => this._getCatFile(), filePath, 'HEAD');
  }

  async getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    return diffOps.getFileAtRef(this.ctx, () => this._getCatFile(), filePath, ref);
  }

  async getFileAtIndex(filePath: string): Promise<string | null> {
    return diffOps.getFileAtIndex(this.ctx, () => this._getCatFile(), filePath);
  }

  async getFileDiff(filePath: string, base?: DiffMode | GitObjectRef): Promise<DiffResult> {
    return diffOps.getFileDiff(this.ctx, this.fs, filePath, base);
  }

  async getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
    return diffOps.getCommitFileDiff(this.ctx, commitHash, filePath);
  }

  async getLog(options?: {
    maxCount?: number;
    skip?: number;
    knownAheadCount?: number;
    preferredRemote?: string;
    base?: GitObjectRef;
    head?: GitObjectRef;
  }): Promise<{ commits: Commit[]; aheadCount: number; publication: BranchPublication }> {
    return logOps.getLog(this.ctx, this.authCtx, options);
  }

  async getLatestCommit(): Promise<Commit | null> {
    const { commits } = await this.getLog({ maxCount: 1 });
    return commits[0] || null;
  }

  async getChangedFiles(base: DiffMode | GitObjectRef | MergeBaseRange): Promise<GitChange[]> {
    return logOps.getChangedFiles(this.ctx, base);
  }

  async getCommitFiles(commitHash: string): Promise<CommitFile[]> {
    return logOps.getCommitFiles(this.ctx, commitHash);
  }

  // --- Remote operations ---

  async commit(message: string): Promise<Result<{ hash: string }, CommitError>> {
    return remoteOps.commit(this.ctx, message);
  }

  async fetch(remote?: string): Promise<Result<void, FetchError>> {
    return remoteOps.fetch(this.ctx, this.authCtx, remote);
  }

  async push(preferredRemote?: string): Promise<Result<{ output: string }, PushError>> {
    return remoteOps.push(this.ctx, this.authCtx, preferredRemote);
  }

  async publishBranch(
    branchName: string,
    remote = 'origin'
  ): Promise<Result<{ output: string }, PushError>> {
    return remoteOps.publishBranch(this.ctx, this.authCtx, branchName, remote);
  }

  async pull(): Promise<Result<{ output: string }, PullError>> {
    return remoteOps.pull(this.authCtx, this.ctx);
  }

  async softReset(): Promise<Result<{ subject: string; body: string }, SoftResetError>> {
    return remoteOps.softReset(this.ctx, (opts) => this.getLog(opts));
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    return remoteOps.getRemotes(this.ctx);
  }

  async getHeadState(): Promise<GitHeadState> {
    return remoteOps.getHeadState(this.ctx);
  }

  async addRemote(name: string, url: string): Promise<void> {
    return remoteOps.addRemote(this.ctx, name, url);
  }

  async fetchPrForReview(
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    localBranch: string,
    isFork: boolean,
    configuredRemote = 'origin'
  ): Promise<Result<void, FetchPrForReviewError>> {
    return repoOps.fetchPrForReview(
      this.ctx,
      this.authCtx,
      prNumber,
      headRefName,
      headRepositoryUrl,
      localBranch,
      isFork,
      configuredRemote
    );
  }

  async detectInfo(): Promise<GitInfo> {
    return repoOps.detectInfo(this.ctx, this.authCtx);
  }

  async initRepository(): Promise<void> {
    return repoOps.initRepository(this.ctx);
  }

  // --- Branch operations ---

  async getCurrentBranch(): Promise<string | null> {
    return branchOps.getCurrentBranch(this.ctx);
  }

  async getWorktreeGitDir(mainDotGitAbs: string): Promise<string> {
    return branchOps.getWorktreeGitDir(this.ctx, mainDotGitAbs);
  }

  async getBranches(): Promise<Branch[]> {
    return branchOps.getBranches(this.ctx, () => this.getRemotes());
  }

  async getDefaultBranch(remote = 'origin'): Promise<string> {
    return branchOps.getDefaultBranch(this.ctx, this.authCtx, remote);
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote = true,
    remote = 'origin'
  ): Promise<Result<void, CreateBranchError>> {
    return branchOps.createBranch(this.ctx, this.authCtx, name, from, syncWithRemote, remote);
  }

  async renameBranch(
    oldBranch: string,
    newBranch: string
  ): Promise<Result<{ remotePushed: boolean }, RenameBranchError>> {
    return branchOps.renameBranch(this.ctx, this.authCtx, oldBranch, newBranch);
  }

  async deleteBranch(branch: string, force = true): Promise<Result<void, DeleteBranchError>> {
    return branchOps.deleteBranch(this.ctx, branch, force);
  }
}
