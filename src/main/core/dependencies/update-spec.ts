import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { AgentLatestSource } from '@shared/agent-updates';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { CODEX_LATEST_CHANNEL_URL } from './latest-version';
import { resolveCommandPath } from './probe';

/** npm's global install location: launchers go in `prefix` (Windows) or `prefix/bin`. */
export interface NpmGlobalLocation {
  prefix: string;
  /** Where global packages live: `<prefix>\node_modules` or `<prefix>/lib/node_modules`. */
  root: string;
}

/** How an installed agent is updated, and where its latest version is read. */
export interface AgentUpdateSpec {
  command: string;
  source: AgentLatestSource;
}

const NPM_TIMEOUT_MS = 15_000;

/**
 * npm's global prefix and package root, as npm itself reports them. Throws
 * when npm is not on PATH; `findNpmGlobalLocation` is for callers to whom a
 * missing npm is a normal answer.
 */
export async function readNpmGlobalLocation(ctx: IExecutionContext): Promise<NpmGlobalLocation> {
  const npm = await resolveCommandPath('npm', ctx);
  if (!npm) throw new Error('npm is not on PATH');
  const run = async (...args: string[]) =>
    (await ctx.exec(npm, args, { timeout: NPM_TIMEOUT_MS })).stdout.trim();
  const [prefix, root] = await Promise.all([run('prefix', '-g'), run('root', '-g')]);
  return { prefix, root };
}

/** npm's global location, or `null` when npm is not installed. */
export async function findNpmGlobalLocation(
  ctx: IExecutionContext
): Promise<NpmGlobalLocation | null> {
  if (!(await resolveCommandPath('npm', ctx))) return null;
  return readNpmGlobalLocation(ctx);
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Whether `binPath` is npm's global install of `pkg`. Paths are compared
 * resolved: with nvm-windows, `C:\Program Files\nodejs` on PATH is a link to
 * `%APPDATA%\nvm\<version>`.
 *   - Windows: npm's launchers sit in the prefix, and the `.cmd` one names the
 *     package it runs (`%dp0%\node_modules\opencode-ai\bin\…`).
 *   - Elsewhere: the bin is a link into `<root>/<pkg>/`.
 */
export function isNpmGlobalInstall(
  binPath: string,
  pkg: string,
  npmGlobal: NpmGlobalLocation
): boolean {
  if (!existsSync(binPath)) return false;
  if (process.platform === 'win32') {
    if (!samePath(realpathSync(dirname(binPath)), realpathSync(npmGlobal.prefix))) return false;
    const launcher = join(dirname(binPath), `${basename(binPath, extname(binPath))}.cmd`);
    if (!existsSync(launcher)) return false;
    const packageDir = `\\node_modules\\${pkg.replace('/', '\\')}\\`.toLowerCase();
    return readFileSync(launcher, 'utf-8').toLowerCase().includes(packageDir);
  }
  const packageRoot = join(npmGlobal.root, pkg);
  if (!existsSync(packageRoot)) return false;
  return realpathSync(binPath).startsWith(realpathSync(packageRoot) + sep);
}

/**
 * The update command for an installed agent, decided from how it was installed
 * (devstation-ext), or `null` when Chord has none for it:
 *   - Codex: `codex update`, which detects Codex's own install method and runs
 *     the matching updater (codex-rs `cli/src/main.rs` run_update_command).
 *     Its latest version is npm's when the binary is npm's, otherwise the
 *     native installer's release channel.
 *   - Claude Code: none; it updates itself.
 *   - Others: `npm install -g <pkg>@latest`, only for npm's global install of
 *     the agent's package.
 */
export function resolveAgentUpdateSpec(
  agent: { id: AgentProviderId; npmPackage: string | undefined; resolvedPath: string },
  npmGlobal: NpmGlobalLocation | null
): AgentUpdateSpec | null {
  const { id, npmPackage, resolvedPath } = agent;
  if (id === 'claude') return null;
  const installedByNpm =
    npmPackage !== undefined &&
    npmGlobal !== null &&
    isNpmGlobalInstall(resolvedPath, npmPackage, npmGlobal);

  if (id === 'codex') {
    return {
      command: 'codex update',
      source: installedByNpm
        ? { kind: 'npm', package: npmPackage }
        : { kind: 'codex-channel', url: CODEX_LATEST_CHANNEL_URL },
    };
  }
  if (!installedByNpm) return null;
  return {
    command: `npm install -g ${npmPackage}@latest`,
    source: { kind: 'npm', package: npmPackage },
  };
}
