import { findCommandOnPath } from '@main/core/dependencies/path-lookup';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';

/** An environment variable read case-blind, as Windows names it (`Path`, `PATH`). */
function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * Whether `cmd` is installed: on the PATH an external tool is launched with
 * (`buildExternalToolEnv`), read in this process. It used to run
 * `command -v <cmd>` through the platform shell, which on Windows is cmd.exe —
 * no `command` there, so every editor detected this way read as missing, after
 * a spawn per command on the main thread.
 */
export function checkCommand(cmd: string): Promise<boolean> {
  const env = buildExternalToolEnv();
  return findCommandOnPath(cmd, {
    path: readEnv(env, 'PATH'),
    pathExt: readEnv(env, 'PATHEXT'),
    platform: process.platform,
  }).then((path) => path !== null);
}
