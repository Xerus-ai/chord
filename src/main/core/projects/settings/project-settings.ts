import fs from 'node:fs';
import path from 'node:path';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import type { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { parseTeamConfig } from '@main/core/repo-config/read-team-config';
import { appSettingsService } from '@main/core/settings/settings-service';
import { getDefaultSshWorktreeDirectory } from '@main/core/settings/worktree-defaults';
import {
  projectSettingsSchema,
  type ProjectSettings,
  type ProjectSettingsProvider,
} from './schema';

/**
 * `.chord.json` in a project's working tree, for the `projects`-table tier.
 * The work-item path reads the file at a lane's target ref instead
 * (`core/repo-config/`). Both parse with `parseTeamConfig`, which throws on an
 * invalid file rather than quietly applying defaults.
 */

const defaults = () => projectSettingsSchema.parse({});

function serialize(settings: ProjectSettings): Result<string, UpdateProjectSettingsError> {
  const parsed = projectSettingsSchema.safeParse(settings);
  if (!parsed.success) return err({ type: 'invalid-settings' });
  return ok(JSON.stringify(parsed.data, null, 2));
}

export class LocalProjectSettingsProvider implements ProjectSettingsProvider {
  constructor(
    private readonly projectPath: string,
    private readonly defaultBranchFallback: string = 'main'
  ) {}

  async get(): Promise<ProjectSettings> {
    const settingsPath = path.join(this.projectPath, '.chord.json');
    if (!fs.existsSync(settingsPath)) {
      return defaults();
    }
    return parseTeamConfig(fs.readFileSync(settingsPath, 'utf8'), settingsPath);
  }

  async update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>> {
    const content = serialize(settings);
    if (!content.success) return content;
    try {
      fs.writeFileSync(path.join(this.projectPath, '.chord.json'), content.data);
      return ok();
    } catch {
      return err({ type: 'error' });
    }
  }

  async ensure(): Promise<void> {
    const settingsPath = path.join(this.projectPath, '.chord.json');
    if (!fs.existsSync(settingsPath)) {
      fs.writeFileSync(settingsPath, JSON.stringify(defaults(), null, 2));
    }
  }

  async getDefaultBranch(): Promise<string> {
    return (await this.get()).baseBranch ?? this.defaultBranchFallback;
  }

  async getRemote(): Promise<string> {
    return (await this.get()).remote ?? 'origin';
  }

  async getWorktreeDirectory(): Promise<string> {
    return (await appSettingsService.get('localProject')).defaultWorktreeDirectory;
  }
}

export class SshProjectSettingsProvider implements ProjectSettingsProvider {
  constructor(
    private readonly fs: SshFileSystem,
    private readonly defaultBranchFallback: string = 'main',
    /** Filesystem rooted at `/` on the host; when given, the worktree directory is created on read. */
    private readonly rootFs?: Pick<FileSystemProvider, 'mkdir'>,
    private readonly projectPath: string = '/'
  ) {}

  async get(): Promise<ProjectSettings> {
    const exists = await this.fs.exists('.chord.json');
    if (!exists) {
      return defaults();
    }
    return parseTeamConfig((await this.fs.read('.chord.json')).content, '.chord.json (ssh)');
  }

  async update(settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>> {
    const content = serialize(settings);
    if (!content.success) return content;
    try {
      await this.fs.write('.chord.json', content.data);
      return ok();
    } catch {
      return err({ type: 'error' });
    }
  }

  async ensure(): Promise<void> {
    const exists = await this.fs.exists('.chord.json');
    if (!exists) {
      await this.fs.write('.chord.json', JSON.stringify(defaults(), null, 2));
    }
  }

  async getDefaultBranch(): Promise<string> {
    return (await this.get()).baseBranch ?? this.defaultBranchFallback;
  }

  async getRemote(): Promise<string> {
    return (await this.get()).remote ?? 'origin';
  }

  async getWorktreeDirectory(): Promise<string> {
    const directory = getDefaultSshWorktreeDirectory(this.projectPath);
    await this.rootFs?.mkdir(directory, { recursive: true });
    return directory;
  }
}
