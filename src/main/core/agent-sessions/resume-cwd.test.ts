import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Review round 1 (devstation-4x42.242): a session with no recorded cwd
 * resumes where its work item's primary lane starts sessions, which for a
 * companion lane is the companion root, where its conversation is kept.
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
const { repos, workItems, workItemWorktrees } = await import('@main/db/schema-work-items');
const { resolveResumeCwd } = await import('./resume-agent-session');

const companionPath = path.resolve('pool', 'login');
const lanePath = path.join(companionPath, 'app');

beforeEach(() => {
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
    .values({
      id: 'lane-c',
      workItemId: 'item-1',
      path: lanePath,
      isPrimary: 1,
      companionPath,
      companionRepoPath: path.resolve('companion'),
    })
    .run();
});

describe('resolveResumeCwd', () => {
  it("resumes a session with no recorded cwd at the primary lane's companion root", () => {
    expect(resolveResumeCwd({ cwd: null, workItemId: 'item-1' })).toBe(companionPath);
  });

  it('keeps the cwd a session recorded', () => {
    expect(resolveResumeCwd({ cwd: lanePath, workItemId: 'item-1' })).toBe(lanePath);
  });
});
