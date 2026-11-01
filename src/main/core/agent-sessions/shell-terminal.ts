import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { err, ok } from '@shared/result';
import type { TerminalShell } from '@shared/terminal-shells';
import {
  detectTerminalShells,
  findTerminalShell,
} from '@main/core/terminal-shells/detect-terminal-shells';
import { startShellSession } from '@main/core/work-items/session-service';
import { resolveSessionLaneEnv } from '@main/core/work-items/session-task-env';
import { db } from '@main/db/client';
import { agentSessions, type WorkItemWorktreeRow } from '@main/db/schema-work-items';

function resolveInstalledShell(shellId: string): TerminalShell | undefined {
  return findTerminalShell(
    detectTerminalShells({ platform: process.platform, env: process.env }),
    shellId
  );
}

/**
 * Inserts and starts a plain shell terminal session in `worktree`. The row has
 * no agent provider; `shell` records which shell so a resume relaunches it,
 * and the title is the shell's label for the tab.
 */
export async function createShellTerminalSession(args: {
  workItemId: string;
  worktree: WorkItemWorktreeRow;
  shellId: string;
}) {
  const shell = resolveInstalledShell(args.shellId);
  if (!shell) return err({ type: 'shell_not_found' as const, shell: args.shellId });

  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const cwd = resolve(args.worktree.path);

  await db.insert(agentSessions).values({
    id,
    workItemId: args.workItemId,
    kind: 'terminal',
    agentProviderId: null,
    shell: shell.id,
    communication: 'pty',
    title: shell.label,
    cwd,
    worktreeId: args.worktree.id,
    status: 'active',
    createdAt: now,
    lastActiveAt: now,
  });

  startShellSession(id, args.workItemId, {
    cwd,
    shell,
    taskEnvVars: await resolveSessionLaneEnv(id),
  });

  const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).limit(1);
  return ok({ session: row });
}

/** Relaunches a suspended shell terminal with the shell its row recorded. */
export async function resumeShellTerminalSession(row: {
  id: string;
  workItemId: string;
  shell: string;
  cwd: string;
}) {
  const shell = resolveInstalledShell(row.shell);
  if (!shell) return err({ type: 'shell_not_found' as const, shell: row.shell });
  startShellSession(row.id, row.workItemId, {
    cwd: row.cwd,
    shell,
    taskEnvVars: await resolveSessionLaneEnv(row.id),
  });
  const [updated] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, row.id))
    .limit(1);
  return ok({ session: updated });
}
