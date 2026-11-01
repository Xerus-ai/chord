import type {
  ClientConnection,
  InitializeResponse,
  ListSessionsResponse,
  SessionInfo,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import packageJson from '@root/package.json';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { withTimeout } from '@shared/result';
import type { ImportableSession, SessionSourceUnsupported } from '@shared/session-import';
import { resolveAcpBridge } from '@main/core/acp/resolve-acp-bridge';
import { spawnAcpProcess, stopAcpProcess } from '@main/core/acp/spawn-acp-process';
import { log } from '@main/lib/logger';
import {
  buildAcpImportMessages,
  describeAcpSessionSupport,
  selectImportableAcpSessions,
} from './acp-history';
import { SessionNotFoundError, type ProviderSessionHistory } from './claude-session-source';

/** How long one listing or load may take before the agent is given up on. */
const AGENT_TIMEOUT_MS = 60_000;

interface AcpAgentHandle {
  agent: ClientConnection['agent'];
  initialized: InitializeResponse;
  /** `session/update` notifications received so far, by session id. */
  updates: Map<string, SessionUpdate[]>;
}

/**
 * A short-lived connection to an installed ACP agent: initialize, run `work`,
 * stop the agent and wait until it is gone (`stopAcpProcess`). It asks for
 * nothing, so a permission request is refused.
 */
async function withAcpAgent<T>(
  providerId: AgentProviderId,
  cwd: string,
  work: (handle: AcpAgentHandle) => Promise<T>
): Promise<T> {
  const acpConfig = getProvider(providerId)?.acpConfig;
  if (!acpConfig) throw new Error(`No ACP config for provider ${providerId}`);
  const { command, args } = await resolveAcpBridge(acpConfig);
  // Loaded on first use, and before the spawn: nothing may await between the
  // spawn and the process listeners below.
  const { client, PROTOCOL_VERSION } = await import('@agentclientprotocol/sdk');
  const { child, stream, closed } = await spawnAcpProcess({ command, args, cwd });
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000);
  });
  const exited = new Promise<never>((_, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      reject(new Error(`${providerId} exited (code ${code})${stderr ? `: ${stderr.trim()}` : ''}`))
    );
  });

  const updates = new Map<string, SessionUpdate[]>();
  const app = client({ name: 'Chord' })
    .onRequest('session/request_permission', () => ({ outcome: { outcome: 'cancelled' as const } }))
    .onNotification('session/update', ({ params }) => {
      const { sessionId, update } = params as { sessionId: string; update: SessionUpdate };
      const list = updates.get(sessionId) ?? [];
      list.push(update);
      updates.set(sessionId, list);
    });
  const connection = app.connect(stream);
  const run = async () => {
    const initialized = await connection.agent.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'chord', title: 'Chord', version: packageJson.version },
    });
    return work({ agent: connection.agent, initialized, updates });
  };
  // Both settle before this returns or throws: the agent runs in the lane's
  // folder, and a caller may remove that folder next (lane Delete).
  const [outcome] = await Promise.allSettled([
    withTimeout(Promise.race([run(), exited]), AGENT_TIMEOUT_MS),
  ]);
  const [stop] = await Promise.allSettled([stopAcpProcess(child, closed)]);
  if (outcome.status === 'rejected') {
    if (stop.status === 'rejected') {
      log.warn('session-import: an ACP agent outlived its stop', {
        providerId,
        error: String(stop.reason),
      });
    }
    throw outcome.reason;
  }
  if (stop.status === 'rejected') throw stop.reason;
  return outcome.value;
}

async function listSessionsIn(
  agent: ClientConnection['agent'],
  cwd: string
): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  let cursor: string | null | undefined;
  do {
    const page: ListSessionsResponse = await agent.request('session/list', { cwd, cursor });
    sessions.push(...page.sessions);
    cursor = page.nextCursor;
  } while (cursor);
  return sessions;
}

export type AcpListing =
  | { kind: 'listed'; lanes: Map<string, ImportableSession[]> }
  | { kind: 'unsupported'; unsupported: SessionSourceUnsupported };

/** Each lane's sessions of one ACP agent, when it can both list and load them. */
export async function listAcpImportableSessions(
  providerId: AgentProviderId,
  lanes: { worktreeId: string; path: string }[],
  owned: ReadonlySet<string>
): Promise<AcpListing> {
  if (lanes.length === 0) return { kind: 'listed', lanes: new Map() };
  return withAcpAgent(providerId, lanes[0].path, async ({ agent, initialized }) => {
    const support = describeAcpSessionSupport(initialized);
    if (!support.canList)
      return { kind: 'unsupported', unsupported: { providerId, reason: 'no_session_list' } };
    if (!support.canLoad)
      return { kind: 'unsupported', unsupported: { providerId, reason: 'no_session_load' } };
    const found = new Map<string, ImportableSession[]>();
    for (const lane of lanes) {
      found.set(
        lane.worktreeId,
        selectImportableAcpSessions(
          providerId,
          await listSessionsIn(agent, lane.path),
          lane.path,
          owned
        )
      );
    }
    return { kind: 'listed', lanes: found };
  });
}

/**
 * An ACP session's history: `session/load` replays it as `session/update`
 * notifications before it replies (spike S6). The listing supplies its title
 * and last activity; ACP updates carry no times, so the rows count back from
 * that last activity in replay order (`buildAcpImportMessages`).
 */
export async function readAcpSessionHistory(
  providerId: AgentProviderId,
  lanePath: string,
  providerSessionId: string
): Promise<ProviderSessionHistory> {
  return withAcpAgent(providerId, lanePath, async ({ agent, initialized, updates }) => {
    const support = describeAcpSessionSupport(initialized);
    if (!support.canList || !support.canLoad) {
      throw new Error(`${providerId} can't list and load its sessions`);
    }
    const listed = selectImportableAcpSessions(
      providerId,
      await listSessionsIn(agent, lanePath),
      lanePath,
      new Set()
    ).find((session) => session.providerSessionId === providerSessionId);
    if (!listed) throw new SessionNotFoundError(providerSessionId);
    await agent.request('session/load', {
      sessionId: providerSessionId,
      cwd: lanePath,
      mcpServers: [],
    });
    const at = listed.lastActivityAt ?? Date.now();
    return {
      title: listed.title,
      lastActivityAt: listed.lastActivityAt,
      messages: buildAcpImportMessages(updates.get(providerSessionId) ?? [], at, lanePath),
    };
  });
}
