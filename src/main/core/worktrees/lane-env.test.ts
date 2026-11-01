import net from 'node:net';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { buildLaneEnv, ensureLanePortBlock, LANE_PORT_BLOCK_SIZE } from './lane-env';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const REPO_PATH = process.platform === 'win32' ? 'C:\\repos\\app' : '/repos/app';
const LANE_PATH = process.platform === 'win32' ? 'C:\\pool\\app\\fix' : '/pool/app/fix';

function insertLane(id: string, portBase: number | null = null): void {
  db.insert(workItemWorktrees)
    .values({
      id,
      workItemId: 'item-1',
      path: `${LANE_PATH}-${id}`,
      branchName: `chord/${id}`,
      isPrimary: id === 'lane-a' ? 1 : 0,
      targetRef: 'origin/main',
      portBase,
    })
    .run();
}

function listen(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

describe('lane env', () => {
  beforeEach(() => {
    db.insert(repos).values({ id: 'repo-1', path: REPO_PATH, alias: 'app' }).run();
    db.insert(workItems)
      .values({ id: 'item-1', name: 'Fix login', repoId: 'repo-1', repoPath: LANE_PATH })
      .run();
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
  });

  it('is the same contract for every launch path', async () => {
    insertLane('lane-a');

    const env = await buildLaneEnv('lane-a');

    expect(env).toMatchObject({
      CHORD_ROOT_PATH: `${LANE_PATH}-lane-a`,
      CHORD_SOURCE_PATH: REPO_PATH,
      CHORD_TARGET_REF: 'origin/main',
      CHORD_LANE_ID: 'lane-a',
      CHORD_TASK_ID: 'item-1',
      CHORD_TASK_PATH: `${LANE_PATH}-lane-a`,
    });
    expect(Number(env.CHORD_PORT)).toBeGreaterThan(0);
  });

  it('allocates each lane its own port block, and keeps it', async () => {
    insertLane('lane-a');
    insertLane('lane-b');

    const a = await ensureLanePortBlock('lane-a');
    const b = await ensureLanePortBlock('lane-b');

    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(LANE_PORT_BLOCK_SIZE);
    expect(await ensureLanePortBlock('lane-a')).toBe(a);
    const [row] = db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.id, 'lane-a'))
      .all();
    expect(row.portBase).toBe(a);
  });

  it('skips a block another process is already listening on', async () => {
    insertLane('lane-a');
    const first = await ensureLanePortBlock('lane-a');
    // The next block in order is taken by something outside Chord.
    const busy = await listen(first + LANE_PORT_BLOCK_SIZE);
    try {
      insertLane('lane-b');
      const second = await ensureLanePortBlock('lane-b');
      expect(second).not.toBe(first + LANE_PORT_BLOCK_SIZE);
      expect(second).not.toBe(first);
    } finally {
      busy.close();
    }
  });
});
