import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { LocalProjectSettingsProvider, SshProjectSettingsProvider } from './project-settings';

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn().mockResolvedValue({
      defaultWorktreeDirectory: '/tmp/chord/worktrees',
    }),
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
  },
}));

describe('LocalProjectSettingsProvider', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      removeDirSync(dir);
    }
  });

  function projectWith(content?: string): string {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-settings-local-'));
    tempDirs.push(projectPath);
    if (content !== undefined) fs.writeFileSync(path.join(projectPath, '.chord.json'), content);
    return projectPath;
  }

  it('reads defaults when the project has no .chord.json', async () => {
    const provider = new LocalProjectSettingsProvider(projectWith(), 'main');
    await expect(provider.get()).resolves.toMatchObject({ filesToCopy: ['.env*', '.envrc'] });
  });

  it('throws on an unreadable .chord.json instead of silently using defaults', async () => {
    const provider = new LocalProjectSettingsProvider(projectWith('{ "scripts": '), 'main');
    await expect(provider.get()).rejects.toThrow(/\.chord\.json/);
  });

  it('throws on a key that was renamed, naming the new one', async () => {
    const provider = new LocalProjectSettingsProvider(
      projectWith(JSON.stringify({ preservePatterns: ['.env'] })),
      'main'
    );
    await expect(provider.get()).rejects.toThrow(/filesToCopy/);
  });

  it('reads the base branch from baseBranch, else the fallback', async () => {
    const configured = new LocalProjectSettingsProvider(
      projectWith(JSON.stringify({ baseBranch: 'develop' })),
      'main'
    );
    const unconfigured = new LocalProjectSettingsProvider(projectWith('{}'), 'trunk');

    await expect(configured.getDefaultBranch()).resolves.toBe('develop');
    await expect(unconfigured.getDefaultBranch()).resolves.toBe('trunk');
  });

  it('keeps worktrees out of the team file: the folder is the app setting', async () => {
    const provider = new LocalProjectSettingsProvider(projectWith('{}'), 'main');
    await expect(provider.getWorktreeDirectory()).resolves.toBe('/tmp/chord/worktrees');
  });

  it('writes validated settings and rejects invalid ones', async () => {
    const projectPath = projectWith();
    const provider = new LocalProjectSettingsProvider(projectPath, 'main');

    const written = await provider.update({ filesToCopy: ['.env'] });
    expect(written.success).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(path.join(projectPath, '.chord.json'), 'utf8'));
    expect(persisted.filesToCopy).toEqual(['.env']);

    const rejected = await provider.update({ filesToCopy: '.env' } as never);
    expect(rejected).toEqual({ success: false, error: { type: 'invalid-settings' } });
  });
});

describe('SshProjectSettingsProvider', () => {
  it('uses the project-scoped ssh worktree directory', async () => {
    const projectFs = { exists: vi.fn().mockResolvedValue(false) } as unknown as SshFileSystem;

    const provider = new SshProjectSettingsProvider(projectFs, 'main', undefined, '/remote/repo');
    await expect(provider.getWorktreeDirectory()).resolves.toBe('/remote/repo/.chord/worktrees');
  });

  it('throws on an unreadable remote .chord.json', async () => {
    const projectFs = {
      exists: vi.fn().mockResolvedValue(true),
      read: vi.fn().mockResolvedValue({ content: 'not json' }),
    } as unknown as SshFileSystem;

    const provider = new SshProjectSettingsProvider(projectFs, 'main', undefined, '/remote/repo');
    await expect(provider.get()).rejects.toThrow(/\.chord\.json/);
  });
});
