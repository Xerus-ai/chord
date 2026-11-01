import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { claudeProjectKey, ClaudeTrustService } from './claude-trust-service';

const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockRename = vi.hoisted(() => vi.fn());
const mockRm = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  promises: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    rename: mockRename,
    rm: mockRm,
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function notFound(pathName: string): FileSystemError {
  return new FileSystemError(
    `File not found: ${pathName}`,
    FileSystemErrorCodes.NOT_FOUND,
    pathName
  );
}

function makeService(overrides: { autoTrustWorktrees?: boolean } = {}): ClaudeTrustService {
  return new ClaudeTrustService({
    getTaskSettings: () =>
      Promise.resolve({ autoTrustWorktrees: overrides.autoTrustWorktrees ?? true }),
  });
}

function makeRemoteFs(
  overrides: Partial<Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>> = {}
): Pick<FileSystemProvider, 'realPath' | 'read' | 'write'> {
  return {
    realPath: vi.fn(async (p: string) => p),
    read: vi.fn().mockRejectedValue(notFound('/home/remote-user/.claude.json')),
    write: vi.fn().mockResolvedValue({ success: true, bytesWritten: 0 }),
    ...overrides,
  };
}

/**
 * Claude Code 2.1.286 looks a folder up in `~/.claude.json` by its path with
 * forward slashes, on Windows too; a backslashed key never matches, so the
 * trust prompt still shows (live probe, bead devstation-s0k).
 */
describe('claudeProjectKey', () => {
  it('keys a Windows path with forward slashes', () => {
    expect(claudeProjectKey('C:\\Users\\me\\chord\\worktrees\\app\\lane', 'win32')).toBe(
      'C:/Users/me/chord/worktrees/app/lane'
    );
  });

  it('resolves a relative Windows path before keying it', () => {
    expect(claudeProjectKey('C:\\repo\\..\\lanes\\.\\one', 'win32')).toBe('C:/lanes/one');
  });

  it('keeps a POSIX path as it is', () => {
    expect(claudeProjectKey('/home/me/lane', 'linux')).toBe('/home/me/lane');
  });
});

describe('ClaudeTrustService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  it('skips non-Claude providers', async () => {
    const service = makeService();

    await service.maybeAutoTrustLocal({
      providerId: 'codex',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('skips when auto-trust is disabled', async () => {
    const service = makeService({ autoTrustWorktrees: false });

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('writes local config atomically when missing', async () => {
    const service = makeService();
    const relPath = './relative/path';

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: relPath,
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockRename).toHaveBeenCalledTimes(1);

    const [tmpPath, content] = mockWriteFile.mock.calls[0];
    const [renameFrom, renameTo] = mockRename.mock.calls[0];
    const configPath = path.join('/home/local-user', '.claude.json');
    expect(tmpPath).toContain(`${configPath}.`);
    expect(tmpPath).toContain('.tmp');
    expect(renameFrom).toBe(tmpPath);
    expect(renameTo).toBe(configPath);

    const written = JSON.parse(String(content));
    expect(written.projects[claudeProjectKey(relPath)]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
  });

  it('is idempotent when already trusted', async () => {
    const service = makeService();
    // The service keys projects the way Claude reads them (`claudeProjectKey`)
    // — the fixture must use that form to count as trusted.
    const trustedPath = path.resolve('/already/trusted');
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        projects: {
          [claudeProjectKey(trustedPath)]: {
            hasTrustDialogAccepted: true,
            hasCompletedProjectOnboarding: true,
          },
        },
      })
    );

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: trustedPath,
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('refuses to overwrite corrupt JSON and logs a warning', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue('{ invalid json');

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'ClaudeTrustService: refusing to overwrite corrupt Claude config',
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  it('refuses to overwrite non-object config root', async () => {
    const service = makeService();
    mockReadFile.mockResolvedValue(JSON.stringify([1, 2, 3]));

    await service.maybeAutoTrustLocal({
      providerId: 'claude',
      cwd: '/tmp/worktree',
      homedir: '/home/local-user',
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'ClaudeTrustService: refusing to overwrite non-object Claude config root'
    );
  });

  it('serializes concurrent calls so no trust entry is lost', async () => {
    const service = makeService();
    let callCount = 0;

    mockReadFile.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return null;
      const [, content] = mockWriteFile.mock.calls[0];
      return String(content);
    });

    await Promise.all([
      service.maybeAutoTrustLocal({
        providerId: 'claude',
        cwd: '/worktree/a',
        homedir: '/home/local-user',
      }),
      service.maybeAutoTrustLocal({
        providerId: 'claude',
        cwd: '/worktree/b',
        homedir: '/home/local-user',
      }),
    ]);

    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    const secondWriteContent = JSON.parse(String(mockWriteFile.mock.calls[1][1]));
    expect(secondWriteContent.projects[claudeProjectKey('/worktree/a')]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
    expect(secondWriteContent.projects[claudeProjectKey('/worktree/b')]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
  });

  it('writes ssh config and renames tmp file remotely', async () => {
    const service = makeService();
    const remoteFs = makeRemoteFs({
      realPath: vi.fn().mockResolvedValue('/remote/worktree'),
    });

    const ctx: IExecutionContext = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn().mockImplementation(async (command: string, args: string[] = []) => {
        if (command === 'sh') {
          return { stdout: '/home/remote-user', stderr: '' };
        }
        if (command === 'mv') {
          expect(args[0]).toContain('/home/remote-user/.claude.json.');
          expect(args[1]).toBe('/home/remote-user/.claude.json');
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await service.maybeAutoTrustSsh({
      providerId: 'claude',
      cwd: '/remote/worktree',
      ctx,
      remoteFs,
    });

    expect(remoteFs.read).toHaveBeenCalledWith(
      '/home/remote-user/.claude.json',
      expect.any(Number)
    );
    expect(remoteFs.write).toHaveBeenCalledTimes(1);
    const [tmpPath, content] = vi.mocked(remoteFs.write).mock.calls[0];
    expect(tmpPath).toContain('/home/remote-user/.claude.json.');
    const written = JSON.parse(String(content));
    expect(written.projects['/remote/worktree']).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
    expect(ctx.exec).toHaveBeenCalledWith('mv', [tmpPath, '/home/remote-user/.claude.json']);
  });
});
