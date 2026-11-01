import { existsSync } from 'node:fs';
import path from 'node:path';
import { log } from '@main/lib/logger';
import { cmdExeCommandLine, type CmdExeTarget } from '@main/utils/cmd-exe-command-line';
import { getWindowsEnvValue } from '@main/utils/windows-env';
import { buildTmuxShellLine } from './tmux-session-name';

export type PtyCommandSpec =
  | { kind: 'argv'; command: string; args: string[] }
  | { kind: 'shell-line'; commandLine: string };

export type PtySpawnIntent =
  | {
      kind: 'interactive-shell';
      cwd: string;
      shellSetup?: string;
      tmuxSessionName?: string;
    }
  | {
      kind: 'run-command';
      cwd: string;
      command: PtyCommandSpec;
      shellSetup?: string;
      tmuxSessionName?: string;
    };

export type LocalPtySpawnWarning = 'shell_setup_ignored_on_windows' | 'tmux_unsupported_on_windows';

export type ResolvedLocalPtySpawn = {
  command: string;
  /**
   * argv, or — for cmd.exe — one pre-built command line that node-pty passes
   * through as is (node-pty accepts either; its argv quoting escapes `"` as
   * `\"`, which cmd.exe does not read).
   */
  args: string[] | string;
  cwd: string;
  warnings: LocalPtySpawnWarning[];
};

type FileExists = (candidate: string) => boolean;

function getPosixShell(env: NodeJS.ProcessEnv): string {
  return env.SHELL || '/bin/sh';
}

function getWindowsShell(env: NodeJS.ProcessEnv): string {
  return env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
}

function isWindows(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

function quotePosixArg(input: string): string {
  if (input.length === 0) return "''";
  if (!/[\s'"\\$`\n\r\t;&|<>(){}[\]*?!]/.test(input)) return input;
  return `'${input.replace(/'/g, "'\\''")}'`;
}

function argvToPosixShellLine(command: string, args: string[]): string {
  return [command, ...args].map(quotePosixArg).join(' ');
}

function getWindowsPathDirs(env: NodeJS.ProcessEnv): string[] {
  const rawPath = getWindowsEnvValue(env, 'PATH') ?? '';
  return rawPath.split(path.win32.delimiter).filter(Boolean);
}

function getWindowsPathExts(env: NodeJS.ProcessEnv): string[] {
  const rawPathExt =
    getWindowsEnvValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';
  return rawPathExt
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
}

function hasWindowsPathSeparator(command: string): boolean {
  return command.includes('\\') || command.includes('/');
}

function resolveWindowsCommandPath({
  command,
  cwd,
  env,
  fileExists,
}: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  fileExists: FileExists;
}): string | null {
  if (path.win32.extname(command)) {
    return null;
  }

  const baseCandidates =
    hasWindowsPathSeparator(command) || path.win32.isAbsolute(command)
      ? [path.win32.isAbsolute(command) ? command : path.win32.join(cwd, command)]
      : [
          path.win32.join(cwd, command),
          ...getWindowsPathDirs(env).map((dir) => path.win32.join(dir, command)),
        ];

  for (const base of baseCandidates) {
    for (const ext of getWindowsPathExts(env)) {
      const candidate = `${base}${ext}`;
      if (fileExists(candidate)) return candidate;
    }
  }

  return null;
}

function windowsWarnings(intent: PtySpawnIntent): LocalPtySpawnWarning[] {
  const warnings: LocalPtySpawnWarning[] = [];
  if (intent.shellSetup) warnings.push('shell_setup_ignored_on_windows');
  if (intent.tmuxSessionName) warnings.push('tmux_unsupported_on_windows');
  return warnings;
}

function resolveWindowsSpawn(
  intent: PtySpawnIntent,
  env: NodeJS.ProcessEnv,
  fileExists: FileExists
): ResolvedLocalPtySpawn {
  const warnings = windowsWarnings(intent);
  const shell = getWindowsShell(env);

  if (intent.kind === 'interactive-shell') {
    return { command: shell, args: [], cwd: intent.cwd, warnings };
  }

  if (intent.command.kind === 'shell-line') {
    // One pre-built command line, as Node's `shell: true` builds it: as an
    // argv entry node-pty would escape the line's quotes as \", which cmd.exe
    // does not read. /s strips only the outer pair, so the line runs as written.
    return {
      command: shell,
      args: `/d /s /c "${intent.command.commandLine}"`,
      cwd: intent.cwd,
      warnings,
    };
  }

  const { args } = intent.command;
  const launch = resolveWindowsArgvLaunch(intent.command.command, intent.cwd, env, fileExists);
  switch (launch.kind) {
    case 'cmd-exe':
      return {
        command: shell,
        args: cmdExeCommandLine(launch.command, args, launch.target),
        cwd: intent.cwd,
        warnings,
      };
    case 'powershell':
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launch.command, ...args],
        cwd: intent.cwd,
        warnings,
      };
    case 'direct':
      return { command: launch.command, args, cwd: intent.cwd, warnings };
  }
}

type WindowsArgvLaunch =
  | { kind: 'cmd-exe'; command: string; target: CmdExeTarget }
  | { kind: 'powershell' | 'direct'; command: string };

/**
 * How Windows runs an argv command: a batch file (`.cmd`/`.bat`, what npm
 * installs a global CLI as) only inside cmd.exe, a name PATH and PATHEXT do
 * not resolve through cmd.exe (a builtin, or its "not recognized" error), a
 * `.ps1` through PowerShell, anything else directly.
 */
function resolveWindowsArgvLaunch(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  fileExists: FileExists
): WindowsArgvLaunch {
  const resolvedCommand = resolveWindowsCommandPath({ command, cwd, env, fileExists }) ?? command;
  const ext = path.win32.extname(resolvedCommand).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return { kind: 'cmd-exe', command: resolvedCommand, target: 'batch' };
  }
  if (ext === '.ps1') return { kind: 'powershell', command: resolvedCommand };
  if (!ext) return { kind: 'cmd-exe', command, target: 'program' };
  return { kind: 'direct', command: resolvedCommand };
}

function resolvePosixSpawn(intent: PtySpawnIntent, env: NodeJS.ProcessEnv): ResolvedLocalPtySpawn {
  const shell = getPosixShell(env);

  if (intent.kind === 'interactive-shell') {
    if (intent.tmuxSessionName) {
      const commandLine = intent.shellSetup
        ? `${intent.shellSetup} && exec ${quotePosixArg(shell)} -il`
        : `exec ${quotePosixArg(shell)} -il`;
      return {
        command: shell,
        args: ['-c', buildTmuxShellLine(intent.tmuxSessionName, commandLine)],
        cwd: intent.cwd,
        warnings: [],
      };
    }

    if (intent.shellSetup) {
      return {
        command: shell,
        args: ['-c', `${intent.shellSetup} && exec ${quotePosixArg(shell)} -il`],
        cwd: intent.cwd,
        warnings: [],
      };
    }

    return { command: shell, args: ['-il'], cwd: intent.cwd, warnings: [] };
  }

  const commandLine =
    intent.command.kind === 'shell-line'
      ? intent.command.commandLine
      : argvToPosixShellLine(intent.command.command, intent.command.args);
  const fullCommandLine = intent.shellSetup
    ? `${intent.shellSetup} && ${commandLine}`
    : commandLine;

  if (intent.tmuxSessionName) {
    return {
      command: shell,
      args: ['-c', buildTmuxShellLine(intent.tmuxSessionName, fullCommandLine)],
      cwd: intent.cwd,
      warnings: [],
    };
  }

  return {
    command: shell,
    args: ['-c', fullCommandLine],
    cwd: intent.cwd,
    warnings: [],
  };
}

export function resolveLocalPtySpawn({
  intent,
  platform,
  env,
  fileExists = existsSync,
}: {
  intent: PtySpawnIntent;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists?: FileExists;
}): ResolvedLocalPtySpawn {
  return isWindows(platform)
    ? resolveWindowsSpawn(intent, env, fileExists)
    : resolvePosixSpawn(intent, env);
}

/**
 * Whether `command` runs through cmd.exe here, whose command line ends at a
 * line break: an argument with one cannot reach the command as typed.
 */
export function localCommandRunsThroughCmdExe({
  command,
  cwd,
  platform,
  env,
  fileExists = existsSync,
}: {
  command: string;
  cwd: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists?: FileExists;
}): boolean {
  if (!isWindows(platform)) return false;
  return resolveWindowsArgvLaunch(command, cwd, env, fileExists).kind === 'cmd-exe';
}

export function logLocalPtySpawnWarnings(
  source: string,
  warnings: LocalPtySpawnWarning[],
  context: Record<string, string>
): void {
  if (warnings.length === 0) return;
  log.warn(`${source}: local PTY platform warning`, { ...context, warnings });
}
