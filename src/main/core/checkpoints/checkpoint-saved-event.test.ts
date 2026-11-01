import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * A turn's checkpoint is taken just after the turn ends, so the chat learns
 * of it by event, not by polling: a turn footer that says "No checkpoint was
 * saved for this turn" must not say it while one is being saved (the history
 * e2e, devstation-b4p.4, caught it saying so for up to the 5s poll). Real git
 * and a migrated test DB; the IPC emitter is captured, as in the Solo suites.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const emitted = vi.hoisted(() => [] as { channel: string; payload: unknown }[]);
vi.mock('@main/lib/events', () => ({
  events: {
    emit: (channel: { name: string }, payload: unknown) =>
      emitted.push({ channel: channel.name, payload }),
    on: () => () => {},
    once: () => () => {},
  },
}));

const { db } = await import('@main/db/client');
const { checkpoints } = await import('@main/db/schema-checkpoints');
const { repos, workItems, workItemWorktrees } = await import('@main/db/schema-work-items');
const { GIT_EXECUTABLE } = await import('@main/core/utils/exec');
const { captureTurnCheckpoint } = await import('./checkpoint-service');

let repo: string;

function git(...args: string[]): void {
  execFileSync(GIT_EXECUTABLE, args, { cwd: repo, stdio: 'pipe' });
}

beforeEach(async () => {
  emitted.length = 0;
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'chord-checkpoint-event-')));
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Chord Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'notes.md'), 'base\n');
  git('add', '-A');
  git('commit', '-m', 'base');
  await db.insert(repos).values({ id: 'repo-1', alias: 'repo', path: repo });
  await db
    .insert(workItems)
    .values({ id: 'item-1', name: 'item', repoId: 'repo-1', repoPath: repo });
  await db
    .insert(workItemWorktrees)
    .values({ id: 'lane-1', workItemId: 'item-1', path: repo, isPrimary: 1 });
});

afterEach(async () => {
  await db.delete(checkpoints);
  await db.delete(workItemWorktrees);
  await db.delete(workItems);
  await db.delete(repos);
  removeDirSync(repo);
});

describe('checkpoint:saved', () => {
  it("is emitted with the work item when a turn's checkpoint is saved", async () => {
    writeFileSync(join(repo, 'notes.md'), 'one\n');

    const saved = await captureTurnCheckpoint({
      workItemId: 'item-1',
      turnId: 'turn-1',
      sessionId: null,
      repoPath: repo,
      worktreeId: 'lane-1',
    });

    expect(saved).not.toBeNull();
    expect(emitted).toEqual([{ channel: 'checkpoint:saved', payload: { workItemId: 'item-1' } }]);
  });
});
