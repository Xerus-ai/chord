import { getAcpConnection, removeAcpConnection } from '@main/core/acp/acp-session-store';
import { stopBridge } from '@main/core/chat-messages/pty-chat-bridge';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { capture } from '@main/lib/telemetry';
import type { ActiveSession } from './active-sessions';

function ptyId(sessionId: string): string {
  return `session:${sessionId}`;
}

export async function teardownSession(
  session: ActiveSession,
  opts: { isOrphaned: boolean }
): Promise<void> {
  if (session.chatHandle) {
    try {
      await session.chatHandle.interrupt();
    } catch {}
    session.chatHandle.close();
    session.abortController?.abort();
  } else if (session.mode === 'acp') {
    const connection = getAcpConnection(session.sessionId);
    if (connection) {
      if (!opts.isOrphaned) {
        try {
          await connection.cancel();
        } catch {}
      }
      // Awaited: lane Delete removes the checkout once this resolves.
      try {
        await connection.stop();
      } finally {
        removeAcpConnection(session.sessionId);
      }
    }
  } else if (session.mode === 'pty' || session.mode === 'shell') {
    if (session.kind === 'chat') {
      stopBridge(session.sessionId);
    }
    const pid = ptyId(session.sessionId);
    const pty = ptySessionRegistry.get(pid);
    if (pty) {
      try {
        pty.kill();
      } catch {}
    }
    ptySessionRegistry.unregister(pid);
  }

  if (!opts.isOrphaned) {
    capture('agent_run_finished', { provider: session.providerId, exit_code: -1 });
  }
}
