import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { projectManager } from '../project-manager';
import { getProjectById } from './getProjects';

export async function updateProjectConnection(
  projectId: string,
  connectionId: string
): Promise<void> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!row) throw new Error(`Project ${projectId} not found`);
  if (row.workspaceProvider !== 'ssh')
    throw new Error(`Project ${projectId} is not an SSH project`);
  await db
    .update(projects)
    .set({ sshConnectionId: connectionId, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, projectId));

  // The DB row alone rebinds nothing live: an open ProjectProvider (and its
  // SSH proxy) keeps tunneling over the OLD connection until restart, so the
  // UI would show the new connection while every git operation used the old
  // one. Tear the provider down and rebuild it against the updated row.
  if (projectManager.getProject(projectId)) {
    const closed = await projectManager.closeProject(projectId);
    if (!closed.success) {
      throw new Error(
        `Project ${projectId} connection updated but the old provider failed to close: ${closed.error.message}`
      );
    }
    const project = await getProjectById(projectId);
    if (!project) throw new Error(`Project ${projectId} not found after connection update`);
    const reopened = await projectManager.openProject(project);
    if (!reopened.success) {
      throw new Error(
        `Project ${projectId} failed to reopen on connection ${connectionId}: ${reopened.error.message}`
      );
    }
  }
}
