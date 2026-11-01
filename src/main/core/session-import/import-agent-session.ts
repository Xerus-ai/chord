import { existsSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { err, ok, type Result } from '@shared/result';
import {
  sessionImportSource,
  type SessionImportError,
  type SessionImportSource,
} from '@shared/session-import';
import { announceSessionsChanged } from '@main/core/agent-sessions/announce-sessions-changed';
import { scheduleSessionCloudSync } from '@main/core/agent-sessions/session-cloud-sync';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { readAcpSessionHistory } from './acp-session-source';
import {
  readClaudeSessionHistory,
  SessionNotFoundError,
  type ProviderSessionHistory,
} from './claude-session-source';
import { readCodexThreadHistory } from './codex-session-source';
import { findSessionHolding } from './owned-sessions';
import { writeImportedSession } from './write-imported-session';

export interface ImportAgentSessionArgs {
  workItemId: string;
  worktreeId: string;
  providerId: AgentProviderId;
  providerSessionId: string;
  /** The signed-in user of this machine, who typed the prompts. */
  sender: { id: string | null; name: string };
}

/** The lane's folder, when the lane belongs to the work item and is checked out here. */
function resolveLanePath(
  workItemId: string,
  worktreeId: string
): Result<string, SessionImportError> {
  const [lane] = db
    .select({ path: workItemWorktrees.path, provisionStatus: workItems.provisionStatus })
    .from(workItemWorktrees)
    .innerJoin(workItems, eq(workItems.id, workItemWorktrees.workItemId))
    .where(
      and(
        eq(workItemWorktrees.id, worktreeId),
        eq(workItemWorktrees.workItemId, workItemId),
        isNull(workItemWorktrees.archivedAt)
      )
    )
    .limit(1)
    .all();
  if (!lane) return err({ type: 'lane_not_found' });
  // Until provisioning is done the row points at the repository, not the lane.
  if (lane.provisionStatus !== 'ready' || !existsSync(lane.path)) {
    return err({ type: 'lane_not_checked_out' });
  }
  return ok(lane.path);
}

function readHistory(
  source: SessionImportSource,
  args: ImportAgentSessionArgs,
  lanePath: string
): Promise<ProviderSessionHistory> {
  switch (source) {
    case 'claude':
      return readClaudeSessionHistory(lanePath, args.providerSessionId);
    case 'codex':
      return readCodexThreadHistory(lanePath, args.providerSessionId);
    case 'acp':
      return readAcpSessionHistory(args.providerId, lanePath, args.providerSessionId);
  }
}

/**
 * Imports an agent session found in a lane's folder: a chat session on the
 * lane holding the provider's session id, with every earlier message, so the
 * chat shows the whole conversation and the next send resumes it. Nothing is
 * written unless all of it is (`writeImportedSession`).
 */
export async function importAgentSession(
  args: ImportAgentSessionArgs
): Promise<Result<{ sessionId: string; messageCount: number }, SessionImportError>> {
  const source = sessionImportSource(args.providerId);
  if (source === null) return err({ type: 'provider_unsupported', providerId: args.providerId });
  const lane = resolveLanePath(args.workItemId, args.worktreeId);
  if (!lane.success) return lane;
  const holder = findSessionHolding(args.providerSessionId);
  if (holder) return err({ type: 'already_imported', ...holder });

  let history: ProviderSessionHistory;
  try {
    history = await readHistory(source, args, lane.data);
  } catch (error) {
    if (error instanceof SessionNotFoundError) return err({ type: 'session_not_found' });
    const message = error instanceof Error ? error.message : String(error);
    log.warn('session-import: reading the session failed', {
      providerId: args.providerId,
      providerSessionId: args.providerSessionId,
      error: message,
    });
    return err({ type: 'read_failed', message });
  }

  const written = writeImportedSession({
    workItemId: args.workItemId,
    worktreeId: args.worktreeId,
    cwd: lane.data,
    providerId: args.providerId,
    providerSessionId: args.providerSessionId,
    title: history.title,
    lastActivityAt: history.lastActivityAt,
    sender: args.sender,
    messages: history.messages,
  });
  if (written.success) {
    scheduleSessionCloudSync(args.workItemId);
    announceSessionsChanged(args.workItemId);
  }
  return written;
}
