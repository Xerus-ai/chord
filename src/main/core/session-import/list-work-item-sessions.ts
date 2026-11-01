import { existsSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import {
  sessionImportSource,
  type ImportableSession,
  type SessionSourceFailure,
  type SessionSourceUnsupported,
  type WorkItemImportableSessions,
} from '@shared/session-import';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { listAcpImportableSessions } from './acp-session-source';
import { listClaudeImportableSessions } from './claude-session-source';
import { listCodexImportableSessions } from './codex-session-source';
import { isAgentInstalled } from './installed-agent';
import { readOwnedExternalSessionIds } from './owned-sessions';

/** A folder to list sessions in; `worktreeId` is the key its sessions come back under. */
export type ImportFolder = { worktreeId: string; path: string };
type Lane = ImportFolder;

/** The work item's lanes checked out on this machine. */
function readCheckedOutLanes(workItemId: string): Lane[] {
  const rows = db
    .select({
      worktreeId: workItemWorktrees.id,
      path: workItemWorktrees.path,
      provisionStatus: workItems.provisionStatus,
    })
    .from(workItemWorktrees)
    .innerJoin(workItems, eq(workItems.id, workItemWorktrees.workItemId))
    .where(and(eq(workItemWorktrees.workItemId, workItemId), isNull(workItemWorktrees.archivedAt)))
    .all();
  return rows
    .filter((row) => row.provisionStatus === 'ready' && existsSync(row.path))
    .map((row) => ({ worktreeId: row.worktreeId, path: row.path }));
}

interface SourceResult {
  lanes: Map<string, ImportableSession[]>;
  unsupported?: SessionSourceUnsupported;
}

async function listClaude(lanes: Lane[], owned: ReadonlySet<string>): Promise<SourceResult> {
  const found = new Map<string, ImportableSession[]>();
  for (const lane of lanes)
    found.set(lane.worktreeId, await listClaudeImportableSessions(lane.path, owned));
  return { lanes: found };
}

async function listAcp(providerId: AgentProviderId, lanes: Lane[], owned: ReadonlySet<string>) {
  const listing = await listAcpImportableSessions(providerId, lanes, owned);
  return listing.kind === 'listed'
    ? { lanes: listing.lanes }
    : { lanes: new Map(), unsupported: listing.unsupported };
}

const newestFirst = (a: ImportableSession, b: ImportableSession) =>
  (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);

/** Every checked-out lane's agent sessions Chord does not own (`listFolderImportableSessions`). */
export async function listWorkItemImportableSessions(
  workItemId: string
): Promise<WorkItemImportableSessions> {
  return listFolderImportableSessions(readCheckedOutLanes(workItemId));
}

/**
 * Each folder's agent sessions Chord does not own, from every source on this
 * machine at once: Claude's transcripts, one Codex app-server for all folders,
 * and one process per installed ACP agent. A source that fails is named with
 * its error; the others still list. The folders need not be lanes yet: Adopt
 * lists a checkout's sessions before it creates the lane.
 */
export async function listFolderImportableSessions(
  lanes: ImportFolder[]
): Promise<WorkItemImportableSessions> {
  const owned = readOwnedExternalSessionIds();
  const sources: { providerId: AgentProviderId; run: () => Promise<SourceResult> }[] = [
    { providerId: 'claude', run: () => listClaude(lanes, owned) },
  ];
  for (const provider of AGENT_PROVIDERS) {
    const source = sessionImportSource(provider.id);
    if (source !== 'codex' && source !== 'acp') continue;
    if (!(await isAgentInstalled(provider.id))) continue;
    sources.push({
      providerId: provider.id,
      run:
        source === 'codex'
          ? async () => ({ lanes: await listCodexImportableSessions(lanes, owned) })
          : () => listAcp(provider.id, lanes, owned),
    });
  }

  const settled = await Promise.allSettled(sources.map((source) => source.run()));
  const byLane = new Map(lanes.map((lane) => [lane.worktreeId, [] as ImportableSession[]]));
  const failures: SessionSourceFailure[] = [];
  const unsupported: SessionSourceUnsupported[] = [];
  settled.forEach((outcome, index) => {
    const { providerId } = sources[index];
    if (outcome.status === 'rejected') {
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      log.warn('session-import: a session source failed', { providerId, error: message });
      failures.push({ providerId, message });
      return;
    }
    if (outcome.value.unsupported) unsupported.push(outcome.value.unsupported);
    for (const [worktreeId, sessions] of outcome.value.lanes)
      byLane.get(worktreeId)?.push(...sessions);
  });

  return {
    lanes: [...byLane].map(([worktreeId, sessions]) => ({
      worktreeId,
      sessions: sessions.sort(newestFirst),
    })),
    failures,
    unsupported,
  };
}
