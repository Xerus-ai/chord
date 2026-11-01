import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
import { isValidEnvVarName, quoteShellArg } from '@main/utils/shellEscape';
import { buildTmuxShellLine } from './tmux-session-name';

export type SessionType = 'agent' | 'general';
export type SessionConfig = AgentSessionConfig | GeneralSessionConfig;

/**
 * Renders an argv array as a POSIX shell line. Every word is quoted
 * individually so metacharacters in a command or argument stay part of that
 * word instead of being parsed as shell syntax by the remote shell.
 */
function buildArgvShellLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteShellArg).join(' ');
}

function posixShellLineForSsh(
  type: SessionType,
  config: SessionConfig
): { cwd: string; line: string } {
  const shell = process.env.SHELL ?? '/bin/sh';

  switch (type) {
    case 'agent': {
      const cfg = config as AgentSessionConfig;
      const baseCmd = buildArgvShellLine(cfg.command, cfg.args);
      const line = cfg.shellSetup ? `${cfg.shellSetup} && ${baseCmd}` : baseCmd;
      return {
        cwd: cfg.cwd,
        line: cfg.tmuxSessionName ? buildTmuxShellLine(cfg.tmuxSessionName, line) : line,
      };
    }
    case 'general': {
      const cfg = config as GeneralSessionConfig;
      const baseCmd = cfg.command
        ? buildArgvShellLine(cfg.command, cfg.args ?? [])
        : `exec ${quoteShellArg(shell)} -il`;
      const line = cfg.shellSetup ? `${cfg.shellSetup} && ${baseCmd}` : baseCmd;
      return {
        cwd: cfg.cwd,
        line: cfg.tmuxSessionName ? buildTmuxShellLine(cfg.tmuxSessionName, line) : line,
      };
    }
    default:
      throw new Error(`Unsupported session type: ${type}`);
  }
}

/**
 * Build a single command string for SSH remote execution.
 */
export function resolveSshCommand(
  type: SessionType,
  config: SessionConfig,
  envVars?: Record<string, string>
): string {
  const { cwd, line } = posixShellLineForSsh(type, config);
  const envPrefix = envVars ? buildSshEnvPrefix(envVars) : '';
  const commandString = `cd ${quoteShellArg(cwd)} && ${envPrefix}${line}`;

  return `bash -l -c ${quoteShellArg(commandString)}`;
}

/**
 * Builds `export K='V'; ...` for the remote shell.
 *
 * A name is a bare shell word in `export NAME=...`, so it cannot be quoted the
 * way a value can — quoting it would export a literal `'NAME'`. It is
 * validated instead, and an unusable name is a programming error rather than
 * something to skip silently.
 */
export function buildSshEnvPrefix(vars: Record<string, string>): string {
  const entries = Object.entries(vars);
  if (entries.length === 0) return '';
  const exports = entries
    .map(([k, v]) => {
      if (!isValidEnvVarName(k)) {
        throw new Error(`Invalid environment variable name for SSH session: ${JSON.stringify(k)}`);
      }
      return `export ${k}=${quoteShellArg(v)}`;
    })
    .join('; ');
  return exports + '; ';
}
