import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * devstation-4x42.242: a lane nested in a companion worktree starts its
 * sessions at the companion's root, so whatever runs there sees both; a lane
 * without one starts them in its checkout. The database is the substitute the
 * other session suites use; no process is spawned.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { agentSessions, repos, workItems, workItemWorktrees } = await import(
  '@main/db/schema-work-items'
);
const { agentSessionsController } = await import('./controller');
const { resolveNewChatSessionWorktree, resolveTargetSessionCwd } = await import(
  '@main/core/chat-messages/resolve-chat-session'
);

const companionPath = path.resolve('pool', 'login');
const lanePath = path.join(companionPath, 'app');
const plainPath = path.resolve('pool', 'plain');

beforeEach(() => {
  db.delete(agentSessions).run();
  db.delete(workItemWorktrees).run();
  db.delete(workItems).run();
  db.delete(repos).run();
  db.insert(repos)
    .values({ id: 'repo-1', path: path.resolve('repo'), alias: 'repo' })
    .run();
  db.insert(workItems)
    .values({ id: 'item-1', name: 'item', repoId: 'repo-1', repoPath: lanePath })
    .run();
  db.insert(workItemWorktrees)
    .values([
      {
        id: 'lane-c',
        workItemId: 'item-1',
        path: lanePath,
        isPrimary: 1,
        companionPath,
        companionRepoPath: path.resolve('companion'),
      },
      { id: 'lane-p', workItemId: 'item-1', path: plainPath, isPrimary: 0 },
    ])
    .run();
});

describe('where a lane with a companion starts its sessions', () => {
  it('records the companion root as the cwd of a new chat', async () => {
    const created = await agentSessionsController.create({
      workItemId: 'item-1',
      kind: 'chat',
      agentProviderId: 'claude',
    });
    if (!created.success) throw new Error(created.error.type);
    expect(created.data.session.cwd).toBe(companionPath);
  });

  it('keeps the checkout as the cwd of a lane without one', async () => {
    const created = await agentSessionsController.create({
      workItemId: 'item-1',
      kind: 'chat',
      agentProviderId: 'claude',
      worktreeId: 'lane-p',
    });
    if (!created.success) throw new Error(created.error.type);
    expect(created.data.session.cwd).toBe(plainPath);
  });

  it('starts a chat sent to the item, or to one of its sessions, at the companion root', async () => {
    expect(resolveNewChatSessionWorktree('item-1')).toEqual({
      worktreeId: 'lane-c',
      cwd: companionPath,
    });
    db.insert(agentSessions)
      .values({ id: 's-1', workItemId: 'item-1', kind: 'chat', worktreeId: 'lane-c' })
      .run();
    expect(resolveTargetSessionCwd('s-1')).toEqual({ success: true, data: companionPath });
  });
});
