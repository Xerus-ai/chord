import type { FileSystemProvider } from '@main/core/fs/types';
import type { GitFetchService } from '@main/core/git/git-fetch-service';
import type { GitRepositoryService, RepoSettingsReader } from '@main/core/git/repository-service';
import type { WorkspaceGitProvider } from '@main/core/git/workspace-git-provider';
import type { LifecycleScriptService } from './workspace-lifecycle-service';

export interface Workspace {
  readonly id: string;
  readonly path: string;
  readonly fs: FileSystemProvider;
  readonly git: WorkspaceGitProvider;
  readonly settings: RepoSettingsReader;
  readonly lifecycleService: LifecycleScriptService;
  readonly repository: GitRepositoryService;
  readonly fetchService: GitFetchService;
}
