import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TerminalShell, TerminalShellId } from '@shared/terminal-shells';
import { getWindowsEnvValue } from '@main/utils/windows-env';

type FileExists = (candidate: string) => boolean;

interface DetectArgs {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists?: FileExists;
}

const POSIX_SHELLS: Array<{ id: TerminalShellId; label: string; binary: string }> = [
  { id: 'bash', label: 'Bash', binary: 'bash' },
  { id: 'zsh', label: 'Zsh', binary: 'zsh' },
  { id: 'fish', label: 'Fish', binary: 'fish' },
  { id: 'sh', label: 'sh', binary: 'sh' },
];

function findOnWindowsPath(env: NodeJS.ProcessEnv, file: string, fileExists: FileExists) {
  const dirs = (getWindowsEnvValue(env, 'PATH') ?? '').split(path.win32.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.win32.join(dir, file);
    if (fileExists(candidate)) return candidate;
  }
  return undefined;
}

function findOnPosixPath(env: NodeJS.ProcessEnv, binary: string, fileExists: FileExists) {
  const dirs = (env.PATH ?? '').split(path.posix.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.posix.join(dir, binary);
    if (fileExists(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Git for Windows keeps its bash in `<root>\bin`, while the `git.exe` on PATH
 * can be `<root>\cmd`, `<root>\bin` or `<root>\mingw64\bin` depending on how
 * the process was launched — so walk up from git until `bin\bash.exe`
 * appears. A bare `bash.exe` on PATH is usually WSL's launcher in System32,
 * which is not Git Bash — so Git Bash is found through git.
 */
function findGitBash(env: NodeJS.ProcessEnv, fileExists: FileExists) {
  const git = findOnWindowsPath(env, 'git.exe', fileExists);
  if (!git) return undefined;
  let dir = path.win32.dirname(git);
  for (let depth = 0; depth < 3; depth++) {
    const bash = path.win32.join(dir, 'bin', 'bash.exe');
    if (fileExists(bash)) return bash;
    dir = path.win32.dirname(dir);
  }
  return undefined;
}

function detectWindowsShells(env: NodeJS.ProcessEnv, fileExists: FileExists): TerminalShell[] {
  const shells: TerminalShell[] = [];
  const comSpec = getWindowsEnvValue(env, 'ComSpec');
  if (comSpec && fileExists(comSpec)) {
    shells.push({ id: 'cmd', label: 'Command Prompt', command: comSpec, args: [] });
  }
  const powershell = findOnWindowsPath(env, 'powershell.exe', fileExists);
  if (powershell) {
    shells.push({ id: 'powershell', label: 'PowerShell', command: powershell, args: ['-NoLogo'] });
  }
  const pwsh = findOnWindowsPath(env, 'pwsh.exe', fileExists);
  if (pwsh) {
    shells.push({ id: 'pwsh', label: 'PowerShell 7', command: pwsh, args: ['-NoLogo'] });
  }
  const gitBash = findGitBash(env, fileExists);
  if (gitBash) {
    shells.push({ id: 'git-bash', label: 'Git Bash', command: gitBash, args: ['--login', '-i'] });
  }
  return shells;
}

function detectPosixShells(env: NodeJS.ProcessEnv, fileExists: FileExists): TerminalShell[] {
  const shells: TerminalShell[] = [];
  const login = env.SHELL ? path.posix.basename(env.SHELL) : undefined;
  const loginDef = POSIX_SHELLS.find((s) => s.binary === login);
  if (loginDef && env.SHELL && fileExists(env.SHELL)) {
    shells.push({ id: loginDef.id, label: loginDef.label, command: env.SHELL, args: ['-il'] });
  }
  for (const def of POSIX_SHELLS) {
    if (shells.some((s) => s.id === def.id)) continue;
    // sh is only offered when nothing better is installed.
    if (def.id === 'sh' && shells.length > 0) continue;
    const command = findOnPosixPath(env, def.binary, fileExists);
    if (command) shells.push({ id: def.id, label: def.label, command, args: ['-il'] });
  }
  return shells;
}

/**
 * Shells installed on this machine, in the order the `+` launcher offers
 * them; the first is the default for "new terminal" shortcuts.
 */
export function detectTerminalShells({
  platform,
  env,
  fileExists = existsSync,
}: DetectArgs): TerminalShell[] {
  return platform === 'win32'
    ? detectWindowsShells(env, fileExists)
    : detectPosixShells(env, fileExists);
}

export function findTerminalShell(shells: TerminalShell[], id: string): TerminalShell | undefined {
  return shells.find((s) => s.id === id);
}
