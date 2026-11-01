import type { AgentProviderId } from '@shared/agent-provider-registry';
import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { importAgentSession } from './import-agent-session';
import { resolveImportSender } from './import-sender';
import { listWorkItemImportableSessions } from './list-work-item-sessions';

export const sessionImportController = createRPCController({
  /** Every lane's agent sessions found on this machine that Chord does not own. */
  listForWorkItem: async (workItemId: string) =>
    ok(await listWorkItemImportableSessions(workItemId)),

  /** Imports one found session, with its history, into a chat on its lane. */
  importSession: async (args: {
    workItemId: string;
    worktreeId: string;
    providerId: AgentProviderId;
    providerSessionId: string;
  }) => importAgentSession({ ...args, sender: await resolveImportSender() }),
});
