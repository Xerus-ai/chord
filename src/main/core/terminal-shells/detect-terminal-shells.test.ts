import { describe, expect, it } from 'vitest';
import { detectTerminalShells, findTerminalShell } from './detect-terminal-shells';

function existsIn(paths: string[]) {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (candidate: string) => set.has(candidate.toLowerCase());
}

describe('detectTerminalShells - Windows', () => {
  const env = {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    Path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Program Files\\PowerShell\\7;D:\\Tools\\Git\\cmd',
  } satisfies NodeJS.ProcessEnv;

  it('lists cmd, Windows PowerShell, PowerShell 7 and Git Bash in that order', () => {
    const shells = detectTerminalShells({
      platform: 'win32',
      env,
      fileExists: existsIn([
        'C:\\Windows\\System32\\cmd.exe',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'D:\\Tools\\Git\\cmd\\git.exe',
        'D:\\Tools\\Git\\bin\\bash.exe',
      ]),
    });

    expect(shells).toEqual([
      { id: 'cmd', label: 'Command Prompt', command: 'C:\\Windows\\System32\\cmd.exe', args: [] },
      {
        id: 'powershell',
        label: 'PowerShell',
        command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        args: ['-NoLogo'],
      },
      {
        id: 'pwsh',
        label: 'PowerShell 7',
        command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        args: ['-NoLogo'],
      },
      {
        id: 'git-bash',
        label: 'Git Bash',
        command: 'D:\\Tools\\Git\\bin\\bash.exe',
        args: ['--login', '-i'],
      },
    ]);
  });

  it('finds Git Bash from the git install, not a bare bash.exe on PATH (WSL)', () => {
    const shells = detectTerminalShells({
      platform: 'win32',
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe', Path: 'C:\\Windows\\System32' },
      fileExists: existsIn(['C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\bash.exe']),
    });

    expect(shells.map((s) => s.id)).toEqual(['cmd']);
  });

  it('omits shells that are not installed', () => {
    const shells = detectTerminalShells({
      platform: 'win32',
      env,
      fileExists: existsIn([
        'C:\\Windows\\System32\\cmd.exe',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ]),
    });

    expect(shells.map((s) => s.id)).toEqual(['cmd', 'powershell']);
  });
});

describe('detectTerminalShells - POSIX', () => {
  it("puts the user's login shell first and adds other installed shells", () => {
    const shells = detectTerminalShells({
      platform: 'darwin',
      env: { SHELL: '/bin/zsh', PATH: '/usr/local/bin:/bin' },
      fileExists: existsIn(['/bin/zsh', '/bin/bash', '/usr/local/bin/fish']),
    });

    expect(shells).toEqual([
      { id: 'zsh', label: 'Zsh', command: '/bin/zsh', args: ['-il'] },
      { id: 'bash', label: 'Bash', command: '/bin/bash', args: ['-il'] },
      { id: 'fish', label: 'Fish', command: '/usr/local/bin/fish', args: ['-il'] },
    ]);
  });
});

describe('findTerminalShell', () => {
  it('resolves a stored shell id against what is installed now', () => {
    const shells = detectTerminalShells({
      platform: 'linux',
      env: { SHELL: '/bin/bash', PATH: '/bin' },
      fileExists: existsIn(['/bin/bash']),
    });

    expect(findTerminalShell(shells, 'bash')?.command).toBe('/bin/bash');
    expect(findTerminalShell(shells, 'zsh')).toBeUndefined();
  });
});
