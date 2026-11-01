import { afterEach, describe, expect, it } from 'vitest';
import {
  createEchoFixture,
  TRICKY_ARGS,
  type EchoFixture,
} from '@main/utils/_testing/cmd-exe-echo-fixture';
import { spawnLocalPty } from './local-pty';
import type { PtyExitInfo } from './pty';
import { localCommandRunsThroughCmdExe, resolveLocalPtySpawn } from './pty-spawn-platform';

const winEnv = {
  ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1',
} satisfies NodeJS.ProcessEnv;

const posixEnv = {
  SHELL: '/bin/bash',
} satisfies NodeJS.ProcessEnv;

describe('resolveLocalPtySpawn - Windows', () => {
  const windowsPathEnv = {
    ...winEnv,
    Path: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs',
  } satisfies NodeJS.ProcessEnv;

  it('uses ComSpec for interactive shells without POSIX flags', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: { kind: 'interactive-shell', cwd: 'C:\\repo' },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('direct-spawns argv commands when no Windows-unsupported shell features are present', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'node.exe', args: ['--version'] },
      },
    });

    expect(result).toEqual({
      command: 'node.exe',
      args: ['--version'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('resolves extensionless commands through PATH and PATHEXT before wrapping cmd shims', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: (candidate) => candidate === 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.CMD',
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'codex', args: ['hello world'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: '/d /s /c ""C:\\Users\\me\\AppData\\Roaming\\npm\\codex.CMD" ^^^"hello^^^ world^^^""',
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('direct-spawns extensionless commands that resolve to exe files', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: (candidate) => candidate === 'C:\\Program Files\\nodejs\\node.EXE',
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'node', args: ['--version'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.EXE',
      args: ['--version'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('falls back to cmd.exe for unresolved extensionless commands', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: () => false,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'codex', args: ['A&B', '100%'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: '/d /s /c ""codex" ^"A^&B^" ^"100^%^""',
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('wraps cmd and bat argv commands through cmd.exe', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'pnpm.cmd', args: ['run', 'dev'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: '/d /s /c ""pnpm.cmd" run dev"',
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('quotes cmd wrapper arguments that contain Windows metacharacters', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'tool.cmd', args: ['hello world', 'A&B'] },
      },
    });

    expect(result.args).toBe('/d /s /c ""tool.cmd" ^^^"hello^^^ world^^^" ^^^"A^^^&B^^^""');
  });

  it('refuses an argument with a line break for a command cmd.exe runs, which would end its line', () => {
    expect(() =>
      resolveLocalPtySpawn({
        platform: 'win32',
        env: winEnv,
        intent: {
          kind: 'run-command',
          cwd: 'C:\\repo',
          command: { kind: 'argv', command: 'tool.cmd', args: ['one\ntwo'] },
        },
      })
    ).toThrow(/line break/);
  });

  it('says which commands cmd.exe runs: batch files and unresolved names, not programs', () => {
    const runs = (command: string, fileExists: (candidate: string) => boolean = () => false) =>
      localCommandRunsThroughCmdExe({
        command,
        cwd: 'C:\\repo',
        platform: 'win32',
        env: windowsPathEnv,
        fileExists,
      });

    expect(runs('C:\\tools\\agent.cmd')).toBe(true);
    expect(runs('agent.BAT')).toBe(true);
    expect(runs('codex', (c) => c === 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.CMD')).toBe(
      true
    );
    expect(runs('unknown-tool')).toBe(true);
    expect(runs('node', (c) => c === 'C:\\Program Files\\nodejs\\node.EXE')).toBe(false);
    expect(runs('C:\\tools\\claude.exe')).toBe(false);
    expect(runs('scripts\\setup.ps1')).toBe(false);
    expect(
      localCommandRunsThroughCmdExe({
        command: 'codex',
        cwd: '/repo',
        platform: 'linux',
        env: posixEnv,
      })
    ).toBe(false);
  });

  it('wraps PowerShell scripts through powershell.exe -File', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'scripts\\setup.ps1', args: ['-Verbose'] },
      },
    });

    expect(result).toEqual({
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\\setup.ps1', '-Verbose'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('runs shell-line commands through cmd.exe /d /s /c', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'shell-line', commandLine: 'pnpm run dev' },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: '/d /s /c "pnpm run dev"',
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('hands a shell-line command with quotes to cmd.exe as written', () => {
    // As an argv entry, node-pty would escape its quotes as \" — which
    // cmd.exe does not read — so it goes as one pre-built command line,
    // the way Node's `shell: true` runs setup: /s strips the outer quotes.
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: {
          kind: 'shell-line',
          commandLine: 'node -e "console.log(\'a b\')" && echo "done"',
        },
      },
    });

    expect(result.args).toBe('/d /s /c "node -e "console.log(\'a b\')" && echo "done""');
  });

  it('returns warnings for ignored shellSetup and tmux on Windows', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'interactive-shell',
        cwd: 'C:\\repo',
        shellSetup: 'source ~/.nvm/nvm.sh',
        tmuxSessionName: 'session-1',
      },
    });

    expect(result.warnings).toEqual([
      'shell_setup_ignored_on_windows',
      'tmux_unsupported_on_windows',
    ]);
  });
});

describe('resolveLocalPtySpawn - POSIX', () => {
  it('uses SHELL -il for interactive shells', () => {
    const result = resolveLocalPtySpawn({
      platform: 'darwin',
      env: posixEnv,
      intent: { kind: 'interactive-shell', cwd: '/repo' },
    });

    expect(result).toEqual({
      command: '/bin/bash',
      args: ['-il'],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('quotes argv commands before shell wrapping', () => {
    const result = resolveLocalPtySpawn({
      platform: 'linux',
      env: posixEnv,
      intent: {
        kind: 'run-command',
        cwd: '/repo',
        command: { kind: 'argv', command: 'node', args: ['script name.js', "it's ok"] },
      },
    });

    expect(result).toEqual({
      command: '/bin/bash',
      args: ['-c', "node 'script name.js' 'it'\\''s ok'"],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('prepends shellSetup to shell-line commands', () => {
    const result = resolveLocalPtySpawn({
      platform: 'linux',
      env: posixEnv,
      intent: {
        kind: 'run-command',
        cwd: '/repo',
        shellSetup: 'source ~/.nvm/nvm.sh',
        command: { kind: 'shell-line', commandLine: 'pnpm run dev' },
      },
    });

    expect(result).toEqual({
      command: '/bin/bash',
      args: ['-c', 'source ~/.nvm/nvm.sh && pnpm run dev'],
      cwd: '/repo',
      warnings: [],
    });
  });
});

describe('resolveLocalPtySpawn - Windows, through a real terminal (devstation-9ge)', () => {
  const fixtures: EchoFixture[] = [];
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.remove();
  });

  async function argsSeenThroughPty(command: string, args: string[], cwd: string, out: string) {
    const resolved = resolveLocalPtySpawn({
      platform: 'win32',
      env: process.env,
      intent: { kind: 'run-command', cwd, command: { kind: 'argv', command, args } },
    });
    const pty = spawnLocalPty({
      id: 'pty-argv-round-trip',
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: { ...processEnv(), ECHO_OUT: out },
      cols: 80,
      rows: 24,
    });
    const exit = await new Promise<PtyExitInfo>((resolve) => pty.onExit(resolve));
    expect(exit.exitCode).toBe(0);
  }

  it.runIf(process.platform === 'win32')(
    'hands an agent launcher (npm shim, folder with a space) every argument as given',
    async () => {
      const fixture = createEchoFixture();
      fixtures.push(fixture);

      await argsSeenThroughPty(fixture.shim, TRICKY_ARGS, fixture.dir, fixture.out);

      expect(fixture.readArgs()).toEqual(TRICKY_ARGS);
    },
    30_000
  );

  it.runIf(process.platform === 'win32')(
    'does the same for a launcher named without its extension, found in the cwd',
    async () => {
      const fixture = createEchoFixture();
      fixtures.push(fixture);

      await argsSeenThroughPty('echo-shim', TRICKY_ARGS, fixture.dir, fixture.out);

      expect(fixture.readArgs()).toEqual(TRICKY_ARGS);
    },
    30_000
  );
});

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}
