import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const claudeConfigDir = realpathSync(mkdtempSync(join(tmpdir(), 'chord-reset-refuse-claude-')));
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

const { db } = await import('@main/db/client');
const { agentSessions, chatMessages, workItemWorktrees } = await import(
  '@main/db/schema-work-items'
);
const { AgentEventBridge } = await import('@main/core/chat-messages/agent-event-bridge');
const { registerActiveSession, unregisterActiveSession } = await import(
  '@main/core/work-items/active-sessions'
);
const { CLAUDE_SESSION_ID, CLAUDE_TURN_1_REF, seedClaudeTranscript } = await import(
  './_testing/seed-transcripts'
);
const {
  addTurnWithoutCheckpoint,
  buildResetFixture,
  clearResetTables,
  SESSION_ID,
  WORK_ITEM_ID,
  WORKTREE_ID,
} = await import('./_testing/reset-fixture');
const { resetToTurn } = await import('./reset-to-turn');

let repo: string;

async function setUp(opts: { turn2HistoryRef?: string | null } = {}): Promise<void> {
  await clearResetTables();
  ({ repo } = await buildResetFixture(opts));
  seedClaudeTranscript(claudeConfigDir, repo);
}

beforeEach(() => setUp());

afterEach(() => {
  unregisterActiveSession(SESSION_ID);
  removeDirSync(repo);
});

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  rmSync(claudeConfigDir, { recursive: true, force: true });
});

/** A refused reset changes nothing: not the files, not the conversation, not the chat. */
function expectUntouched(): void {
  expect(readFileSync(join(repo, 'notes.txt'), 'utf8')).toBe('two\n');
  const [session] = db.select().from(agentSessions).where(eq(agentSessions.id, SESSION_ID)).all();
  expect(session.externalSessionId).toBe(CLAUDE_SESSION_ID);
  const system = db.select().from(chatMessages).where(eq(chatMessages.senderType, 'system')).all();
  expect(system).toEqual([]);
}

async function refusal(turnId: string): Promise<string> {
  const result = await resetToTurn({ workItemId: WORK_ITEM_ID, turnId });
  if (result.success) throw new Error('reset was not refused');
  return result.error.type;
}

describe('resetToTurn refusals', () => {
  it('refuses a turn the chat does not have', async () => {
    expect(await refusal('turn-unknown')).toBe('turn_not_found');
    expectUntouched();
  });

  it('refuses a turn with no checkpoint', async () => {
    await addTurnWithoutCheckpoint('turn-3', CLAUDE_TURN_1_REF);
    expect(await refusal('turn-3')).toBe('no_checkpoint');
    expectUntouched();
  });

  it('refuses a full reset of a turn with no history point (that is "Reset files to here")', async () => {
    removeDirSync(repo);
    await setUp({ turn2HistoryRef: null });
    expect(await refusal('turn-2')).toBe('no_history_point');
    expectUntouched();
  });

  it('refuses an agent whose conversation Chord cannot fork (ACP)', async () => {
    await db
      .update(agentSessions)
      .set({ agentProviderId: 'qwen' })
      .where(eq(agentSessions.id, SESSION_ID));
    expect(await refusal('turn-1')).toBe('no_history_point');
    expectUntouched();
  });

  it('refuses while the chat has a turn running', async () => {
    const bridge = new AgentEventBridge('Claude');
    bridge.setSessionId(SESSION_ID);
    bridge.handleAcpUpdate(WORK_ITEM_ID, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Working on it' },
    });
    registerActiveSession({
      sessionId: SESSION_ID,
      workItemId: WORK_ITEM_ID,
      providerId: 'claude',
      mode: 'claude-sdk',
      kind: 'chat',
      bridge,
    });

    expect(await refusal('turn-1')).toBe('turn_running');
    expectUntouched();
  });

  it('refuses on an archived lane', async () => {
    await db
      .update(workItemWorktrees)
      .set({ archivedAt: Math.floor(Date.now() / 1000) })
      .where(eq(workItemWorktrees.id, WORKTREE_ID));
    expect(await refusal('turn-1')).toBe('lane_archived');
    expectUntouched();
  });

  it('refuses when the lane is not on this machine', async () => {
    const elsewhere = join(tmpdir(), 'chord-reset-lane-not-here');
    await db
      .update(workItemWorktrees)
      .set({ path: elsewhere })
      .where(eq(workItemWorktrees.id, WORKTREE_ID));
    expect(await refusal('turn-1')).toBe('lane_missing');
    expectUntouched();
  });
});
