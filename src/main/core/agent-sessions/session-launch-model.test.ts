import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Real SQLite built from the shipped migrations — the same substitution
 * `repos/controller.test.ts` uses. Not a mock of behaviour: every statement
 * here runs against the real schema, which is the point, since what is under
 * test is that a column survives things the `kv` override store does not.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { agentSessions, repos, workItems } = await import('@main/db/schema-work-items');
const { recordLaunchedModel } = await import('./session-launch-model');

const WORK_ITEM_ID = 'w-1';

async function seedWorkItem(): Promise<void> {
  await db.insert(repos).values({ id: 'r-1', alias: 'chord', path: '/tmp/chord' });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-1',
    repoPath: '/tmp/chord',
    name: 'Right rail',
    // The work item's own model — the session must never inherit this into its
    // column. The column is a record of a launch, not a copy of the default.
    model: 'work-item-default',
  });
}

async function insertSession(
  id: string,
  overrides: { kind?: 'chat' | 'terminal'; status?: string } = {}
): Promise<void> {
  await db.insert(agentSessions).values({
    id,
    workItemId: WORK_ITEM_ID,
    kind: overrides.kind ?? 'chat',
    agentProviderId: 'claude',
    communication: 'acp',
    status: overrides.status ?? 'active',
  });
}

async function readModel(id: string): Promise<string | null | undefined> {
  const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).limit(1);
  return row?.model;
}

beforeEach(async () => {
  await db.delete(agentSessions);
  await db.delete(workItems);
  await db.delete(repos);
  await seedWorkItem();
});

describe('recordLaunchedModel', () => {
  it('records the model a session launched with', async () => {
    await insertSession('s-1');
    recordLaunchedModel('s-1', 'claude-opus-4-6');
    expect(await readModel('s-1')).toBe('claude-opus-4-6');
  });

  // The whole reason this is a column and not the `session-config:` kv row:
  // `loadSessionConfigs` deletes overrides for sessions that reached 'done'
  // (session-config-persistence.ts:41-44), and the finished sessions are
  // exactly the ones the Work item map now lists inline.
  it('survives the session finishing', async () => {
    await insertSession('s-1');
    recordLaunchedModel('s-1', 'claude-opus-4-6');
    await db.update(agentSessions).set({ status: 'done' }).where(eq(agentSessions.id, 's-1'));
    expect(await readModel('s-1')).toBe('claude-opus-4-6');
  });

  // A live session whose model changes is restarted (deliver-to-session.ts:55),
  // so the row must state what it is running NOW, not what it first ran.
  it('a relaunch overwrites the recorded model', async () => {
    await insertSession('s-1');
    recordLaunchedModel('s-1', 'claude-sonnet-4-5');
    recordLaunchedModel('s-1', 'claude-opus-4-6');
    expect(await readModel('s-1')).toBe('claude-opus-4-6');
  });

  // `resolveChatLaunchConfig` returns null for "the provider's own default".
  // That is a real answer and must be stored as null, not skipped — otherwise
  // a relaunch onto the provider default would leave the previous model on the
  // row, and the map would name a model the session is not running.
  it('records a provider default as null, clearing a previous model', async () => {
    await insertSession('s-1');
    recordLaunchedModel('s-1', 'claude-opus-4-6');
    recordLaunchedModel('s-1', null);
    expect(await readModel('s-1')).toBeNull();
  });

  it('leaves a session that never launched null, not the work item default', async () => {
    await insertSession('s-never');
    expect(await readModel('s-never')).toBeNull();
  });

  it('touches only the session it was given', async () => {
    await insertSession('s-1');
    await insertSession('s-2');
    recordLaunchedModel('s-1', 'claude-opus-4-6');
    expect(await readModel('s-2')).toBeNull();
  });

  // A terminal launches a CLI, not a model selection. Nothing calls this for
  // one; the assertion pins that the column stays null if that ever changes.
  it('a terminal session carries no model', async () => {
    await insertSession('s-term', { kind: 'terminal' });
    expect(await readModel('s-term')).toBeNull();
  });
});
