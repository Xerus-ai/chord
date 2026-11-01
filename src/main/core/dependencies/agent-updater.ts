import type { AgentProviderDefinition, AgentProviderId } from '@shared/agent-provider-registry';
import type { AgentUpdateInfo, AgentUpdateResult } from '@shared/agent-updates';
import { err, ok } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { InstallCommandRunner } from './install-runner';
import { fetchLatestVersion } from './latest-version';
import { resolveCommandPath, runVersionProbe } from './probe';
import {
  findNpmGlobalLocation,
  resolveAgentUpdateSpec,
  type AgentUpdateSpec,
  type NpmGlobalLocation,
} from './update-spec';
import { compareVersions } from './version-compare';

/** What the updater needs to know about an agent CLI. */
export interface UpdatableAgent {
  id: AgentProviderId;
  npmPackage: string | undefined;
  /** Binary names to try in order; first found wins. */
  commands: string[];
  versionArgs: string[];
  /** Environment for the version probe; see `AgentProviderDefinition.versionProbeEnv`. */
  versionProbeEnv?: Record<string, string>;
}

export function updatableAgentFromProvider(provider: AgentProviderDefinition): UpdatableAgent {
  return {
    id: provider.id,
    npmPackage: provider.npmPackage,
    commands: provider.commands ?? [provider.cli ?? provider.id],
    versionArgs: provider.versionArgs ?? ['--version'],
    versionProbeEnv: provider.versionProbeEnv,
  };
}

const VERSION_IN_OUTPUT = /\b(\d+\.\d+\.\d+)\b/;

/** Whether Chord could have an update command for this agent at all. */
function mayHaveUpdateSpec(agent: UpdatableAgent): boolean {
  return agent.id === 'codex' || (agent.id !== 'claude' && agent.npmPackage !== undefined);
}

async function resolveAgentPath(agent: UpdatableAgent, ctx: IExecutionContext) {
  for (const command of agent.commands) {
    const path = await resolveCommandPath(command, ctx);
    if (path) return path;
  }
  return null;
}

/** The installed version, as the agent's own `--version` prints it. */
async function readInstalledVersion(
  agent: UpdatableAgent,
  path: string,
  ctx: IExecutionContext
): Promise<string> {
  const probe = await runVersionProbe(agent.commands[0] ?? agent.id, path, agent.versionArgs, ctx, {
    env: agent.versionProbeEnv,
  });
  const printed = `${probe.stdout}\n${probe.stderr}`;
  const match = VERSION_IN_OUTPUT.exec(printed);
  if (probe.exitCode !== 0 || !match) {
    throw new Error(
      `Could not read ${agent.id}'s version from \`${path} ${agent.versionArgs.join(' ')}\` ` +
        `(exit ${String(probe.exitCode)}): ${printed.trim().slice(0, 300)}`
    );
  }
  return match[1];
}

async function resolveInstalledSpec(
  agent: UpdatableAgent,
  ctx: IExecutionContext,
  npmGlobal: NpmGlobalLocation | null | undefined
): Promise<{ path: string; spec: AgentUpdateSpec | null } | null> {
  const path = await resolveAgentPath(agent, ctx);
  if (!path) return null;
  const location = npmGlobal === undefined ? await findNpmGlobalLocation(ctx) : npmGlobal;
  const spec = resolveAgentUpdateSpec(
    { id: agent.id, npmPackage: agent.npmPackage, resolvedPath: path },
    location
  );
  return { path, spec };
}

/**
 * Compares an installed agent with its latest release. `null` when the agent
 * is not installed or Chord has no update command for how it was installed.
 * Pass `npmGlobal` when checking several agents, to read npm's location once.
 */
export async function checkAgentUpdate(
  agent: UpdatableAgent,
  ctx: IExecutionContext,
  npmGlobal?: NpmGlobalLocation | null
): Promise<AgentUpdateInfo | null> {
  if (!mayHaveUpdateSpec(agent)) return null;
  const installed = await resolveInstalledSpec(agent, ctx, npmGlobal);
  if (!installed?.spec) return null;
  const [installedVersion, latestVersion] = await Promise.all([
    readInstalledVersion(agent, installed.path, ctx),
    fetchLatestVersion(installed.spec.source),
  ]);
  return {
    id: agent.id,
    installedVersion,
    latestVersion,
    updateAvailable: compareVersions(installedVersion, latestVersion) < 0,
    source: installed.spec.source,
    checkedAt: Date.now(),
  };
}

/**
 * Runs the agent's update command (outside any lane, through the install
 * runner) and reads the version it now runs. An update that leaves the version
 * as it was is an error: the button that started it promised a newer one.
 */
export async function runAgentUpdate(
  agent: UpdatableAgent,
  ctx: IExecutionContext,
  runInstallCommand: InstallCommandRunner
): Promise<AgentUpdateResult> {
  if (!mayHaveUpdateSpec(agent)) return err({ type: 'no-update-spec', id: agent.id });
  const installed = await resolveInstalledSpec(agent, ctx, undefined);
  if (!installed) return err({ type: 'not-installed', id: agent.id });
  if (!installed.spec) return err({ type: 'no-update-spec', id: agent.id });

  const before = await readInstalledVersion(agent, installed.path, ctx);
  const run = await runInstallCommand(installed.spec.command);
  if (!run.success) return err(run.error);

  const pathAfter = await resolveAgentPath(agent, ctx);
  if (!pathAfter) return err({ type: 'not-installed', id: agent.id });
  const version = await readInstalledVersion(agent, pathAfter, ctx);
  if (version === before) {
    return err({ type: 'version-unchanged', id: agent.id, version, output: run.data.output });
  }
  return ok({ version, output: run.data.output });
}
