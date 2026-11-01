import os from 'node:os';
import type { InstallCommandError } from '@shared/dependencies';
import { err, ok, type Result } from '@shared/result';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { log } from '@main/lib/logger';
import { HOST_NPM_PLATFORM_SHELL_PREFIX, withHostNpmPlatform } from '@main/utils/npm-host-platform';
import { ensureUserBinDirsInPath } from '@main/utils/userEnv';
import { quoteShellArg } from '../../utils/shellEscape';

/** What a finished command printed, with terminal control sequences removed. */
export type InstallCommandOutput = { output: string };

export type InstallCommandRunner<TData = InstallCommandOutput, TError = InstallCommandError> = (
  command: string
) => Promise<Result<TData, TError>>;

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
/** Operating-system commands, e.g. the window title cmd.exe sets (`ESC ] 0 ; … BEL`). */
const OSC_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

function cleanTerminalOutput(output: string): string {
  return output.replace(OSC_RE, '').replace(ANSI_RE, '').trim();
}

export function classifyInstallCommandFailure({
  exitCode,
  output,
}: {
  exitCode: number | undefined;
  output: string;
}): InstallCommandError {
  const cleanOutput = cleanTerminalOutput(output);
  if (/\bEACCES\b|permission denied|not have the permissions/i.test(cleanOutput)) {
    return {
      type: 'permission-denied',
      exitCode,
      output: cleanOutput,
      message: 'User does not have sufficient permissions.',
    };
  }

  return {
    type: 'command-failed',
    exitCode,
    output: cleanOutput,
    message: 'Install command failed.',
  };
}

function waitForInstallPty(pty: Pty): Promise<Result<InstallCommandOutput, InstallCommandError>> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    pty.onData((chunk: string) => chunks.push(chunk));
    pty.onExit(({ exitCode }) => {
      if (exitCode === 0) {
        log.info(`[DependencyManager] Install succeeded`);
        resolve(ok({ output: cleanTerminalOutput(chunks.join('')) }));
        return;
      }

      const output = chunks.join('').trim();
      log.error(`[DependencyManager] Install failed`, { exitCode, output });
      resolve(err(classifyInstallCommandFailure({ exitCode, output })));
    });
  });
}

export function runLocalInstallCommand(
  command: string
): Promise<Result<InstallCommandOutput, InstallCommandError>> {
  const installId = `install:${crypto.randomUUID()}`;
  const resolved = resolveLocalPtySpawn({
    platform: process.platform,
    env: process.env,
    intent: {
      kind: 'run-command',
      cwd: os.homedir(),
      command: { kind: 'shell-line', commandLine: command },
    },
  });
  logLocalPtySpawnWarnings('DependencyManager', resolved.warnings, { installId });

  let pty: Pty;
  try {
    pty = spawnLocalPty({
      id: installId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: withHostNpmPlatform(process.env),
      cols: 80,
      rows: 24,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.resolve(err({ type: 'pty-open-failed', message }));
  }

  return waitForInstallPty(pty).then((result) => {
    if (result.success) {
      ensureUserBinDirsInPath();
    }
    return result;
  });
}

export function createSshInstallCommandRunner(proxy: SshClientProxy): InstallCommandRunner {
  return async (command: string) => {
    const result = await openSsh2Pty(proxy.client, {
      id: `install:${crypto.randomUUID()}`,
      command: `bash -l -c ${quoteShellArg(HOST_NPM_PLATFORM_SHELL_PREFIX + command)}`,
      cols: 80,
      rows: 24,
    });

    if (!result.success) {
      return err({ type: 'pty-open-failed', message: result.error.message });
    }

    return waitForInstallPty(result.data);
  };
}
