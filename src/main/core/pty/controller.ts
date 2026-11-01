import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { eq } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import { ptySessionRegistry } from './pty-session-registry';

const WORK_ITEM_PREFIX = 'workitem:';

export const ptyController = createRPCController({
  sendInput: (sessionId: string, data: string) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.write(data);
    return ok();
  },

  resize: (sessionId: string, cols: number, rows: number) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (!pty) return err({ type: 'not_found' as const });
    pty.resize(cols, rows);
    ptySessionRegistry.setLastSize(sessionId, cols, rows);
    return ok();
  },

  subscribe: (sessionId: string) => {
    return ok({ buffer: ptySessionRegistry.subscribe(sessionId) });
  },

  unsubscribe: (sessionId: string) => {
    ptySessionRegistry.unsubscribe(sessionId);
    return ok();
  },

  kill: (sessionId: string) => {
    const pty = ptySessionRegistry.get(sessionId);
    if (pty) {
      try {
        pty.kill();
      } catch (e) {
        log.warn('ptyController.kill: error killing PTY', { sessionId, error: String(e) });
      }
    }
    ptySessionRegistry.unregister(sessionId);
    return ok();
  },

  uploadFiles: async (args: { sessionId: string; localPaths: string[] }) => {
    try {
      let workspaceId: string | undefined;

      if (args.sessionId.startsWith(WORK_ITEM_PREFIX)) {
        const workItemId = args.sessionId.slice(WORK_ITEM_PREFIX.length);
        const [row] = await db
          .select({ id: workItems.id })
          .from(workItems)
          .where(eq(workItems.id, workItemId))
          .limit(1);
        if (!row) return err({ type: 'not_found' as const });
        workspaceId = workItemId;
      } else {
        const [, scopeId] = args.sessionId.split(':');
        workspaceId = scopeId;
      }

      if (!workspaceId) return err({ type: 'invalid_session' as const });

      const workspace = workspaceRegistry.get(workspaceId);
      if (!workspace?.fs.copyLocalFile) return err({ type: 'not_ssh' as const });

      const remotePaths = await Promise.all(
        args.localPaths.map(async (localPath) => {
          const remoteName = `${randomUUID()}-${basename(localPath)}`;
          await workspace.fs.copyLocalFile!(localPath, remoteName);
          return `${workspace.path}/${remoteName}`;
        })
      );
      return ok({ remotePaths });
    } catch (e: unknown) {
      log.error('pty:uploadFiles failed', {
        sessionId: args.sessionId,
        error: (e as Error)?.message || e,
      });
      return err({ type: 'upload_failed' as const, message: String((e as Error)?.message || e) });
    }
  },
});
