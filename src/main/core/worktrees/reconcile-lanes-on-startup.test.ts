import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseProvisionError } from '@shared/work-item-provision-error';
import { db } from '@main/db/client';
import { workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { reconcileLanesOnStartup } from './reconcile-lanes-on-startup';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

let logDir: string;

function addItem(id: string, provisionStatus: string): void {
  db.insert(workItems).values({ id, name: id, repoPath: '/repo', provisionStatus }).run();
}

function addLane(
  id: string,
  workItemId: string,
  setupStatus: string | null,
  setupLogPath: string | null = null
): void {
  db.insert(workItemWorktrees)
    .values({ id, workItemId, path: `/lanes/${id}`, isPrimary: 1, setupStatus, setupLogPath })
    .run();
}

function laneStatus(id: string): string | null {
  const [row] = db.select().from(workItemWorktrees).where(eq(workItemWorktrees.id, id)).all();
  return row.setupStatus;
}

function item(id: string) {
  const [row] = db.select().from(workItems).where(eq(workItems.id, id)).all();
  return row;
}

describe('reconcileLanesOnStartup', () => {
  beforeEach(() => {
    logDir = mkdtempSync(join(tmpdir(), 'chord-reconcile-'));
  });

  afterEach(() => {
    db.delete(workItems).run();
    removeDirSync(logDir);
  });

  it('fails a setup the last run left running, and says why in its log', () => {
    const logPath = join(logDir, 'chord-setup.log');
    writeFileSync(logPath, '[chord] Setup started\n[chord] $ pnpm install\n');
    addItem('item-1', 'ready');
    addLane('lane-1', 'item-1', 'running', logPath);

    const result = reconcileLanesOnStartup();

    expect(laneStatus('lane-1')).toBe('failed');
    expect(readFileSync(logPath, 'utf8')).toBe(
      '[chord] Setup started\n[chord] $ pnpm install\n' +
        '[chord] Setup was interrupted when Chord closed. Retry to run it again.\n'
    );
    expect(result).toEqual({ interruptedProvisions: 0, interruptedSetups: 1 });
  });

  it('fails a setup that was due but never started', () => {
    addItem('item-1', 'ready');
    addLane('lane-1', 'item-1', 'pending');

    reconcileLanesOnStartup();

    expect(laneStatus('lane-1')).toBe('failed');
  });

  it('still fails the setup when its log is gone', () => {
    addItem('item-1', 'ready');
    addLane('lane-1', 'item-1', 'running', join(logDir, 'deleted', 'chord-setup.log'));

    expect(() => reconcileLanesOnStartup()).not.toThrow();
    expect(laneStatus('lane-1')).toBe('failed');
  });

  it('fails provisioning the last run left in progress, so Retry is offered', () => {
    addItem('item-1', 'provisioning');
    addLane('lane-1', 'item-1', 'pending');

    const result = reconcileLanesOnStartup();

    const row = item('item-1');
    expect(row.provisionStatus).toBe('failed');
    expect(parseProvisionError(row.provisionError as string)).toEqual({
      type: 'interrupted',
      message: 'Creating the checkout was interrupted when Chord closed. Retry to create it again.',
    });
    // Its setup never had a checkout to run in: Retry provisions, then sets up.
    expect(laneStatus('lane-1')).toBe('pending');
    expect(result).toEqual({ interruptedProvisions: 1, interruptedSetups: 0 });
  });

  it('leaves settled lanes and items alone', () => {
    addItem('item-ok', 'ready');
    addLane('lane-ok', 'item-ok', 'ok');
    addItem('item-failed', 'failed');
    addLane('lane-failed', 'item-failed', 'failed');
    addItem('item-untracked', 'ready');
    addLane('lane-untracked', 'item-untracked', null);
    addItem('item-skipped', 'ready');
    addLane('lane-skipped', 'item-skipped', 'skipped');

    const result = reconcileLanesOnStartup();

    expect(laneStatus('lane-skipped')).toBe('skipped');
    expect(laneStatus('lane-ok')).toBe('ok');
    expect(laneStatus('lane-failed')).toBe('failed');
    expect(laneStatus('lane-untracked')).toBeNull();
    expect(item('item-ok').provisionStatus).toBe('ready');
    expect(item('item-failed').provisionStatus).toBe('failed');
    expect(result).toEqual({ interruptedProvisions: 0, interruptedSetups: 0 });
  });
});
