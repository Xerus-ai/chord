import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
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
const claudeConfigDir = realpathSync(mkdtempSync(join(tmpdir(), 'chord-fork-tab-claude-')));
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

const { db } = await import('@main/db/client');
const { checkpoints } = await import('@main/db/schema-checkpoints');
const { agentThreadCursors } = await import('@main/db/schema-sync');
const { agentSessions, chatMessages, workItemWorktrees } = await import(
  '@main/db/schema-work-items'
);
const { GIT_EXECUTABLE } = await import('@main/core/utils/exec');
const { resolveClaudeTranscriptPath } = await import(
  '@main/core/agent-sessions/claude-conversation-store'
);
const { CLAUDE_SESSION_ID, seedClaudeTranscript } = await import('./_testing/seed-transcripts');
const { buildResetFixture, clearResetTables, SESSION_ID, WORK_ITEM_ID, WORKTREE_ID } = await import(
  './_testing/reset-fixture'
);
const { forkToNewTab } = await import('./fork-to-new-tab');

let repo: string;

beforeEach(async () => {
  await clearResetTables();
  await db.delete(agentThreadCursors);
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

function sessionRows(sessionId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(sql`rowid`)
    .all();
}

async function forkTurn1(): Promise<string> {
  const result = await forkToNewTab({ workItemId: WORK_ITEM_ID, turnId: 'turn-1' });
  if (!result.success) throw new Error(`fork refused: ${result.error.type}`);
  return result.data.sessionId;
}

describe('forkToNewTab (real DB, git and Agent SDK fork)', () => {
  it('opens a new chat of the same agent on the same lane, resuming a fork that ends at the turn', async () => {
    const sessionId = await forkTurn1();

    const [session] = db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).all();
    expect(session).toMatchObject({
      workItemId: WORK_ITEM_ID,
      worktreeId: WORKTREE_ID,
      kind: 'chat',
      agentProviderId: 'claude',
      title: 'Claude Code (fork)',
    });
    expect(session.externalSessionId).not.toBe(CLAUDE_SESSION_ID);
    const forked = resolveClaudeTranscriptPath(repo, session.externalSessionId as string);
    const forkedText = readFileSync(forked as string, 'utf8');
    expect(forkedText).toContain('ALPHA-17');
    expect(forkedText).not.toContain('BRAVO-29');
  });

  it('copies the thread up to the turn under a "Forked from" row, with new ids', async () => {
    const sessionId = await forkTurn1();

    const rows = sessionRows(sessionId);
    expect(rows.map((row) => row.messageType)).toEqual(['system', 'text', 'agent_turn']);
    const [head, prompt, turn] = rows;
    expect(JSON.parse(head.metadata ?? '{}')).toEqual({
      event: 'forked_from',
      sourceSessionId: SESSION_ID,
      sourceTurnId: 'turn-1',
      sourceTitle: 'Claude Code',
      forkedAt: 100,
    });
    expect(head.content).toBe('Forked from Claude Code');
    expect(prompt).toMatchObject({
      senderType: 'human',
      senderId: 'user-ada',
      content: 'Remember codeword ALPHA-17.',
      createdAt: 90,
      createdAtMs: 90_000,
    });
    expect(prompt.id).not.toBe('prompt-1');
    expect(turn.turnId).not.toBe('turn-1');
    expect(JSON.parse(turn.metadata ?? '{}').turnId).toBe(turn.turnId);
    expect(turn.createdAt).toBe(100);
    expect(turn.createdAtMs).toBe(100_000);
    // The head sits before the copied thread, to the millisecond too.
    expect(head.createdAtMs as number).toBeLessThan(prompt.createdAtMs as number);
  });

  it("gives the copied turn the fork's history ref and its own copy of the checkpoint", async () => {
    const sessionId = await forkTurn1();
    const [session] = db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).all();
    const turn = sessionRows(sessionId).find((row) => row.messageType === 'agent_turn');

    const forked = resolveClaudeTranscriptPath(repo, session.externalSessionId as string);
    expect(readFileSync(forked as string, 'utf8')).toContain(`"uuid":"${turn?.historyRef}"`);

    const [source] = db.select().from(checkpoints).where(eq(checkpoints.turnId, 'turn-1')).all();
    const [copy] = db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.turnId, turn?.turnId as string))
      .all();
    expect(copy).toMatchObject({
      commitSha: source.commitSha,
      sessionId,
      worktreeId: WORKTREE_ID,
      trigger: 'turn_completed',
    });
    expect(copy.id).not.toBe(source.id);
    // Its own ref, so releasing either checkpoint leaves the other's commit reachable.
    const resolved = execFileSync(GIT_EXECUTABLE, ['rev-parse', copy.gitRef as string], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    expect(resolved).toBe(source.commitSha);
  });

  it("starts the new chat's digest after the copied rows, so they are not sent to the agent again", async () => {
    const sessionId = await forkTurn1();

    const [cursor] = db
      .select()
      .from(agentThreadCursors)
      .where(eq(agentThreadCursors.sessionId, sessionId))
      .all();
    const [{ maxRowid }] = db
      .select({ maxRowid: sql<number>`max(rowid)` })
      .from(chatMessages)
      .all();
    expect(cursor.lastRowid).toBe(maxRowid);
  });

  it('leaves the source chat as it was', async () => {
    await forkTurn1();

    const [source] = db.select().from(agentSessions).where(eq(agentSessions.id, SESSION_ID)).all();
    expect(source.externalSessionId).toBe(CLAUDE_SESSION_ID);
    expect(sessionRows(SESSION_ID).map((row) => row.id)).toEqual([
      'prompt-1',
      'row-turn-1',
      'prompt-2',
      'row-turn-2',
    ]);
  });

  it('refuses a turn with no history point, and a lane that is archived', async () => {
    removeDirSync(repo);
    await clearResetTables();
    ({ repo } = await buildResetFixture({ turn2HistoryRef: null }));
    seedClaudeTranscript(claudeConfigDir, repo);

    const noPoint = await forkToNewTab({ workItemId: WORK_ITEM_ID, turnId: 'turn-2' });
    expect(noPoint.success ? null : noPoint.error.type).toBe('no_history_point');

    await db
      .update(workItemWorktrees)
      .set({ archivedAt: Math.floor(Date.now() / 1000) })
      .where(eq(workItemWorktrees.id, WORKTREE_ID));
    const archived = await forkToNewTab({ workItemId: WORK_ITEM_ID, turnId: 'turn-1' });
    expect(archived.success ? null : archived.error.type).toBe('lane_archived');

    expect(db.select().from(agentSessions).all()).toHaveLength(1);
  });
});
