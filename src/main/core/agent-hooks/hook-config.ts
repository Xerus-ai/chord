import { existsSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Settings } from '@anthropic-ai/claude-agent-sdk';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { makeCodexNotifyCommand } from './agent-notify-command';
import { buildClaudeHooks, PI_EXTENSION_PATH } from './chord-hook-entries';
import { excludeFromGit } from './git-info-exclude';
import { removeOldHookConfig } from './hook-config-leftovers';
import piChordExtension from './pi-chord-extension.ts?raw';

/**
 * How Chord hands its hook config to an agent CLI it launches in a terminal,
 * so the agent's lifecycle events reach the hook server. Nothing of it may
 * show up as the user's change (devstation-bmj, devstation-tx0):
 *   - Claude Code: one `--settings` file in Chord's profile directory. It
 *     carries the rest of Chord's flag settings too — with two `--settings`
 *     flags Claude Code applies only the last — and its hooks run next to the
 *     user's own (probe-bmj). Flag settings still apply when a setting source
 *     is left out, so the trust gate leaves them alone.
 *   - Codex: `notify` as a `-c` override. A project `.codex/config.toml` is
 *     ignored until the folder is trusted in CODEX_HOME, which Chord never
 *     writes.
 *   - Pi: its extension file in the checkout, hidden by `.git/info/exclude`.
 */
export interface AgentHookLaunch {
  /** Flags to put ahead of the CLI's own arguments (before any subcommand). */
  args: string[];
  /** Removes what the launch left in Chord's profile directory; runs when the terminal exits. */
  cleanup: () => void;
}

export interface PrepareAgentHookLaunchOptions {
  providerId: AgentProviderId;
  sessionId: string;
  cwd: string;
  /** Chord's own directory for per-session launch files, never inside the checkout. */
  launchDir: string;
  /** The other flag-layer settings Chord launches a Claude session with (`buildClaudeFlagSettings`). */
  claudeSettings: Settings | undefined;
  platform: NodeJS.Platform;
}

const HOOKED_PROVIDERS: readonly AgentProviderId[] = ['claude', 'codex', 'pi'];

export async function prepareAgentHookLaunch(
  opts: PrepareAgentHookLaunchOptions
): Promise<AgentHookLaunch> {
  if (!HOOKED_PROVIDERS.includes(opts.providerId)) return { args: [], cleanup: () => {} };

  const git = new LocalExecutionContext({ root: opts.cwd });
  await removeOldHookConfig({ cwd: opts.cwd, git, platform: opts.platform });

  switch (opts.providerId) {
    case 'claude':
      return writeClaudeHookSettings(opts);
    case 'codex': {
      const notify = makeCodexNotifyCommand({ platform: opts.platform });
      return { args: ['-c', `notify=${toTomlStringArray(notify)}`], cleanup: () => {} };
    }
    default:
      await writePiExtension(opts.cwd, git);
      return { args: [], cleanup: () => {} };
  }
}

async function writeClaudeHookSettings(
  opts: PrepareAgentHookLaunchOptions
): Promise<AgentHookLaunch> {
  await mkdir(opts.launchDir, { recursive: true });
  const settingsPath = join(opts.launchDir, `${opts.sessionId}.settings.json`);
  await writeFile(
    settingsPath,
    JSON.stringify({ ...(opts.claudeSettings ?? {}), hooks: buildClaudeHooks() }),
    'utf-8'
  );
  return {
    args: ['--settings', settingsPath],
    cleanup: () => rmSync(settingsPath, { force: true }),
  };
}

async function writePiExtension(cwd: string, git: IExecutionContext): Promise<void> {
  const path = join(cwd, PI_EXTENSION_PATH);
  const existing = existsSync(path) ? await readFile(path, 'utf-8') : null;
  if (existing !== piChordExtension) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, piChordExtension);
  }
  await excludeFromGit(git, cwd, PI_EXTENSION_PATH);
}

/**
 * A TOML array for a Codex `-c` value. Literal strings (`'…'`) wherever the
 * value allows it: they need no escaping and hold no double quote, which
 * `cmd.exe` would mangle when the CLI is a `.cmd` shim. A value holding a
 * single quote (only the POSIX notify command, spawned without `cmd.exe`) is
 * a basic string; JSON's escapes are all valid TOML basic-string escapes.
 */
function toTomlStringArray(values: string[]): string {
  const strings = values.map((value) =>
    /['\r\n]/.test(value) ? JSON.stringify(value) : `'${value}'`
  );
  return `[${strings.join(',')}]`;
}
