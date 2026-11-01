import { eq } from 'drizzle-orm';
import { ok } from '@shared/result';
import { db } from '@main/db/client';
import { agentSessions } from '@main/db/schema-work-items';
import { applyLivePermissionMode } from './apply-live-permission-mode';
import { applyLiveChatSelection } from './apply-live-selection';
import {
  getChatPermissionMode,
  setChatPermissionMode,
  type ChatPermissionMode,
} from './permission-mode-store';
import { scheduleSessionCloudSync } from './session-cloud-sync';
import {
  getChatSessionConfig,
  setChatSessionConfig,
  type ChatSessionConfig,
} from './session-config-store';
import { getSessionTelemetry } from './session-telemetry';

/** A teammate's composer shows the chat's model and mode: republish them. */
async function republishSessionLabels(sessionId: string): Promise<void> {
  const [row] = await db
    .select({ workItemId: agentSessions.workItemId })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);
  if (!row) throw new Error(`No agent session ${sessionId} to republish`);
  scheduleSessionCloudSync(row.workItemId);
}

/**
 * The composer's per-session controls — mode, model/effort/fast, telemetry —
 * served as part of `rpc.agentSessions` (spread into its controller).
 */
export const chatControlProcedures = {
  /** The composer's mode menu: a mode id from the session's catalog, or null
      for the agent's default. With `sessionId` only that session switches;
      without it the work item and all its live sessions do. Live sessions
      switch immediately; the store covers lazily-started and respawned ones. */
  setChatPermissionMode: async (args: {
    workItemId: string;
    mode: ChatPermissionMode;
    sessionId?: string;
  }) => {
    setChatPermissionMode(args.workItemId, args.mode, args.sessionId);
    await applyLivePermissionMode(args.workItemId, args.mode, args.sessionId);
    scheduleSessionCloudSync(args.workItemId);
    return ok({});
  },

  getChatPermissionMode: (args: { workItemId: string; sessionId?: string }) => {
    return ok({ mode: getChatPermissionMode(args.workItemId, args.sessionId) });
  },

  /** A session tab's own model/effort/fast; the work item's columns stay the
      default. A live Claude session takes it in-process for its next turn;
      any other live session is restarted on its next send. */
  setChatSessionConfig: async (args: { sessionId: string } & ChatSessionConfig) => {
    setChatSessionConfig(args.sessionId, {
      model: args.model,
      effort: args.effort,
      fast: args.fast,
    });
    await applyLiveChatSelection(args.sessionId);
    await republishSessionLabels(args.sessionId);
    return ok({});
  },

  /** Context fill and cost a live session has reported so far. */
  getTelemetry: (args: { sessionId: string }) => ok(getSessionTelemetry(args.sessionId)),

  getChatSessionConfig: (args: { sessionId: string }) => {
    return ok({ config: getChatSessionConfig(args.sessionId) });
  },
};
