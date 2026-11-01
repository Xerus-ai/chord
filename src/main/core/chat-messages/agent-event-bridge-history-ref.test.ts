import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { agentSessions, chatMessages, repos, workItems } = await import(
  '@main/db/schema-work-items'
);
const { AgentEventBridge } = await import('./agent-event-bridge');
const { chatMessagesController } = await import('./controller');

const WORK_ITEM_ID = 'wi-history-ref';
const SESSION_ID = 'session-history-ref';

beforeEach(async () => {
  await db.delete(chatMessages);
  await db.delete(agentSessions);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: 'r-1', alias: 'chord', path: '/tmp/chord' });
  await db
    .insert(workItems)
    .values({ id: WORK_ITEM_ID, repoId: 'r-1', repoPath: '/tmp/chord', name: 'History refs' });
  await db.insert(agentSessions).values({
    id: SESSION_ID,
    workItemId: WORK_ITEM_ID,
    kind: 'chat',
    agentProviderId: 'claude',
    status: 'active',
  });
});

function runTurn(historyRef?: string): string {
  const bridge = new AgentEventBridge('Claude');
  bridge.setSessionId(SESSION_ID);
  bridge.handleAcpUpdate(WORK_ITEM_ID, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Done.' },
  });
  const turnId = bridge.getLiveTurnSnapshot()?.turnId;
  if (!turnId) throw new Error('turn did not start');
  bridge.completeTurn(WORK_ITEM_ID, { historyRef });
  return turnId;
}

function turnRow(turnId: string) {
  const [row] = db.select().from(chatMessages).where(eq(chatMessages.turnId, turnId)).all();
  return row;
}

describe('a completed turn keeps its history ref locally', () => {
  it('stores it on the turn row, outside the metadata that syncs', () => {
    const turnId = runTurn('86de37d9-cf18-49b2-9243-cef21fa1ff24');

    const row = turnRow(turnId);
    expect(row.historyRef).toBe('86de37d9-cf18-49b2-9243-cef21fa1ff24');
    expect(row.metadata).not.toContain('86de37d9-cf18-49b2-9243-cef21fa1ff24');
  });

  it('stores none for a turn that reported none', () => {
    const turnId = runTurn(undefined);
    expect(turnRow(turnId).historyRef).toBeNull();
  });

  it('is on the turn the timeline returns', async () => {
    const withRef = runTurn('uuid-turn-with-ref');
    const without = runTurn(undefined);

    const result = await chatMessagesController.getTimelineTurns({ workItemId: WORK_ITEM_ID });
    if (!result.success) throw new Error('timeline failed');
    const byId = new Map(result.data.turns.map((turn) => [turn.turnId, turn]));
    expect(byId.get(withRef)?.historyRef).toBe('uuid-turn-with-ref');
    expect(byId.get(without)?.historyRef).toBeUndefined();
  });
});
