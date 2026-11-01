import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agentSessions } from '@main/db/schema-work-items';
import type { AgentTransport } from './launch-session-transport';

/**
 * Records a session that has just launched, the same for every transport:
 * it is active and running. Reset, respawn and Resume start a session that
 * stopSession had suspended; a launch path that left the status alone kept
 * it reading "suspended" while it ran (devstation-ioly).
 */
export function markSessionLaunched(sessionId: string, transport: AgentTransport): void {
  db.update(agentSessions)
    .set({
      communication:
        transport === 'claude-sdk' || transport === 'codex-app-server' ? 'acp' : transport,
      status: 'active',
      provisionStatus: 'running',
      lastActiveAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(agentSessions.id, sessionId))
    .run();
}
