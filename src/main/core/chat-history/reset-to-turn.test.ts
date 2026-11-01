import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
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

// The SDK reads CLAUDE_CONFIG_DIR once, at first use.
const claudeConfigDir = realpathSync(mkdtempSync(join(tmpdir(), 'chord-reset-claude-')));
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

const { db } = await import('@main/db/client');
const { checkpoints } = await import('@main/db/schema-checkpoints');
const { agentSessions, chatMessages } = await import('@main/db/schema-work-items');
const { resolveClaudeTranscriptPath } = await import(
  '@main/core/agent-sessions/claude-conversation-store'
);
const { CLAUDE_SESSION_ID, seedClaudeTranscript } = await import('./_testing/seed-transcripts');
const { buildResetFixture, clearResetTables, SESSION_ID, WORK_ITEM_ID } = await import(
  './_testing/reset-fixture'
);
const { resetToTurn } = await import('./reset-to-turn');
const { findSessionHolding, readOwnedExternalSessionIds } = await import(
  '@main/core/session-import/owned-sessions'
);
const { listClaudeImportableSessions } = await import(
  '@main/core/session-import/claude-session-source'
);

let repo: string;

beforeEach(async () => {
  await clearResetTables();
  ({ repo } = await buildResetFixture());
  seedClaudeTranscript(claudeConfigDir, repo);
});

afterEach(() => {
  removeDirSync(repo);
});

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  rmSync(claudeConfigDir, { recursive: true, force: true });
});

function externalSessionId(): string | null {
  const [row] = db.select().from(agentSessions).where(eq(agentSessions.id, SESSION_ID)).all();
  return row.externalSessionId;
}

describe('resetToTurn (real DB, git, checkpoints and Agent SDK fork)', () => {
  it("puts the lane's files back to after the turn, keeping the current ones as a pre_revert checkpoint", async () => {
    const result = await resetToTurn({ workItemId: WORK_ITEM_ID, turnId: 'turn-1' });

    expect(result.success).toBe(true);
    expect(readFileSync(join(repo, 'notes.txt'), 'utf8')).toBe('one\n');
    const safety = db
      .select()
      .from(checkpoints)
      .where(and(eq(checkpoints.workItemId, WORK_ITEM_ID), eq(checkpoints.trigger, 'pre_revert')))
      .all();
    expect(safety).toHaveLength(1);
  });

  it('rebinds the chat to a fork that remembers only up to the turn, leaving the original on disk', async () => {
    const result = await resetToTurn({ workItemId: WORK_ITEM_ID, turnId: 'turn-1' });
    if (!result.success) throw new Error(`reset refused: ${result.error.type}`);

    const forkId = externalSessionId();
    expect(forkId).toBe(result.data.forkedExternalId);
    expect(forkId).not.toBe(CLAUDE_SESSION_ID);
    // The next send resumes the fork: Chord's own resume check finds it in the lane's folder.
    const forked = resolveClaudeTranscriptPath(repo, forkId as string);
    expect(forked).not.toBeNull();
    const forkedText = readFileSync(forked as string, 'utf8');
    expect(forkedText).toContain('ALPHA-17');
    expect(forkedText).not.toContain('BRAVO-29');
    const original = resolveClaudeTranscriptPath(repo, CLAUDE_SESSION_ID);
    expect(readFileSync(original as string, 'utf8')).toContain('BRAVO-29');
  });

  it('resets again after a reset: remembered turns point into the fork, forgotten ones nowhere', async () => {
    // A Claude fork gives every entry a new uuid, so turn 1's ref must follow it.
    const first = await resetToTurn({ workItemId: WORK_ITEM_ID, turnId: 'turn-2' });
    if (!first.success) throw new Error(`first reset refused: ${first.error.type}`);
    const second = await resetToTurn({ workItemId: WORK_ITEM_ID, turnId: 'turn-1' });
    if (!second.success) throw new Error(`second reset refused: ${second.error.type}`);

    const forked = resolveClaudeTranscriptPath(repo, second.data.forkedExternalId);
    const forkedText = readFileSync(forked as string, 'utf8');
    expect(forkedText).toContain('ALPHA-17');
    expect(forkedText).not.toContain('BRAVO-29');

    const refs = new Map(
      db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.messageType, 'agent_turn'))
        .all()
        .map((row) => [row.turnId, row.historyRef])
    );
    // Turn 1's ref names an entry of the conversation the chat now resumes.
    expect(forkedText).toContain(`"uuid":"${refs.get('turn-1')}"`);
    // Turn 2 is not in that conversation any more.
    expect(refs.get('turn-2')).toBeNull();
  });

  it('posts a history_reset row in the chat naming the target turn, and deletes nothing', async () => {
    const result = await resetToTurn({ workItemId: WORK_ITEM_ID, turnId: 'turn-1' });
    if (!result.success) throw new Error(`reset refused: ${result.error.type}`);

    const rows = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.workItemId, WORK_ITEM_ID))
      .all();
    const marker = rows.find((row) => row.id === result.data.markerId);
    expect(marker).toMatchObject({
      sessionId: SESSION_ID,
      senderType: 'system',
      messageType: 'system',
    });
    expect(JSON.parse(marker?.metadata ?? '{}')).toEqual({
      event: 'history_reset',
      targetTurnId: 'turn-1',
    });
    expect(marker?.content).toMatch(/Claude/);
    // Both turns stay in the chat: they are dimmed, not removed.
    expect(rows.filter((row) => row.messageType === 'agent_turn')).toHaveLength(2);
  });

  it("keeps the chat's earlier conversations its own: not offered for import, not importable", async () => {
    const first = await resetToTurn({ workItemId: WORK_ITEM_ID, turnId: 'turn-2' });
    if (!first.success) throw new Error(`first reset refused: ${first.error.type}`);
    const second = await resetToTurn({ workItemId: WORK_ITEM_ID, turnId: 'turn-1' });
    if (!second.success) throw new Error(`second reset refused: ${second.error.type}`);

    const offered = (await listClaudeImportableSessions(repo, readOwnedExternalSessionIds())).map(
      (session) => session.providerSessionId
    );
    expect(offered).not.toContain(CLAUDE_SESSION_ID);
    expect(offered).not.toContain(first.data.forkedExternalId);
    expect(offered).not.toContain(second.data.forkedExternalId);
    for (const earlier of [CLAUDE_SESSION_ID, first.data.forkedExternalId]) {
      expect(findSessionHolding(earlier)).toEqual({
        sessionId: SESSION_ID,
        workItemId: WORK_ITEM_ID,
      });
    }
  });
});
