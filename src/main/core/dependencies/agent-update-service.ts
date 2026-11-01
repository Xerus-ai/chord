import { isValidProviderId } from '@shared/agent-provider-registry';
import { getProvider, listDetectableProviders } from '@shared/agent-providers';
import type { AgentUpdateCheckResult, AgentUpdateResult } from '@shared/agent-updates';
import { err } from '@shared/result';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { log } from '@main/lib/logger';
import { checkAgentUpdate, runAgentUpdate, updatableAgentFromProvider } from './agent-updater';
import { localDependencyManager } from './dependency-manager';
import { runLocalInstallCommand } from './install-runner';
import { findNpmGlobalLocation } from './update-spec';

/**
 * Checks every detectable agent installed on this machine against its latest
 * release. An agent whose check fails (a source unreachable, a version that
 * cannot be read) is reported in `failures`; the others still are checked.
 */
export async function checkLocalAgentUpdates(): Promise<AgentUpdateCheckResult> {
  const ctx = new LocalExecutionContext();
  const npmGlobal = await findNpmGlobalLocation(ctx);
  const agents = listDetectableProviders().map(updatableAgentFromProvider);
  const settled = await Promise.allSettled(
    agents.map((agent) => checkAgentUpdate(agent, ctx, npmGlobal))
  );

  const result: AgentUpdateCheckResult = { updates: [], failures: [] };
  settled.forEach((outcome, index) => {
    const { id } = agents[index];
    if (outcome.status === 'rejected') {
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      log.warn(`[AgentUpdates] Update check failed for ${id}: ${message}`);
      result.failures.push({ id, message });
    } else if (outcome.value) {
      result.updates.push(outcome.value);
    }
  });
  return result;
}

/**
 * Updates an agent installed on this machine, outside any lane, then probes
 * it again so Settings shows the version it now runs.
 */
export async function updateLocalAgent(id: string): Promise<AgentUpdateResult> {
  const provider = isValidProviderId(id) ? getProvider(id) : undefined;
  if (!provider) return err({ type: 'unknown-agent', id });

  log.info(`[AgentUpdates] Updating ${provider.id}`);
  const result = await runAgentUpdate(
    updatableAgentFromProvider(provider),
    new LocalExecutionContext(),
    runLocalInstallCommand
  );
  await localDependencyManager.probe(provider.id);
  if (!result.success) log.error(`[AgentUpdates] Update of ${provider.id} failed`, result.error);
  return result;
}
