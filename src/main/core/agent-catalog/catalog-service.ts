import { homedir } from 'node:os';
import { buildStaticCatalog, type AgentControlCatalog } from '@shared/agent-control-catalog';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { resolveAgentExecutable } from '@main/core/agent-sessions/resolve-agent-executable';
import { probeCodexCatalog } from '@main/core/codex-app-server/codex-catalog';
import { log } from '@main/lib/logger';
import { probeClaudeCatalog } from './claude-catalog';
import { getLatestProviderCatalog, getSessionCatalog } from './session-catalogs';

/** Providers whose catalog is asked of the installed agent itself. */
const PROBES: Partial<Record<AgentProviderId, () => Promise<AgentControlCatalog>>> = {
  claude: () => probeClaudeCatalog(homedir()),
  codex: async () =>
    probeCodexCatalog(
      await resolveAgentExecutable({ providerId: 'codex', cli: getProvider('codex')?.cli }),
      homedir()
    ),
};

/**
 * One in-flight or settled probe per provider per app run. A rejected probe
 * is evicted so the next ask retries instead of serving the failure forever.
 */
const probed = new Map<AgentProviderId, Promise<AgentControlCatalog>>();

function loadProbedCatalog(
  providerId: AgentProviderId,
  run: () => Promise<AgentControlCatalog>
): Promise<AgentControlCatalog> {
  const cached = probed.get(providerId);
  if (cached) return cached;
  const probe = run();
  probed.set(providerId, probe);
  probe.catch((e: unknown) => {
    log.warn('agent-catalog: model probe failed', { providerId, error: String(e) });
    if (probed.get(providerId) === probe) probed.delete(providerId);
  });
  return probe;
}

/**
 * What the composer can control for `providerId`, from that provider's own
 * source: a probe of the installed agent (Claude, Codex); else what
 * `sessionId`'s live agent reported, else what the provider's latest session
 * reported, else the static table.
 */
export function getAgentControlCatalog(
  providerId: AgentProviderId,
  sessionId?: string
): Promise<AgentControlCatalog> {
  const run = PROBES[providerId];
  if (run) return loadProbedCatalog(providerId, run);
  const own = sessionId === undefined ? undefined : getSessionCatalog(sessionId);
  if (own && own.providerId === providerId) return Promise.resolve(own);
  return Promise.resolve(getLatestProviderCatalog(providerId) ?? buildStaticCatalog(providerId));
}

/** Drops the cached probe so the next read asks the agent again (e.g. after an update). */
export function refreshAgentControlCatalog(
  providerId: AgentProviderId,
  sessionId?: string
): Promise<AgentControlCatalog> {
  probed.delete(providerId);
  return getAgentControlCatalog(providerId, sessionId);
}
