import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Importing an outside Claude session into a lane, end to end: a real
 * transcript in a real Claude config directory, read and written into a real
 * SQLite database built from the shipped migrations. `electron` is the test
 * keychain (`account/_testing/test-keychain.ts`) because the sync queue's
 * import graph reaches the credential store; nothing is signed in, so the
 * queue records the upload and sends nothing.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-import-session-')));
const configDir = join(root, 'claude-config');
mkdirSync(configDir, { recursive: true });
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = configDir;

const { db } = await import('@main/db/client');
const { agentSessions, chatMessages, repos, workItems, workItemWorktrees } = await import(
  '@main/db/schema-work-items'
);
const { syncQueue } = await import('@main/db/schema-sync');
const { encodeClaudeProjectDir } = await import(
  '@main/core/agent-sessions/claude-conversation-store'
);
const { ClaudeTranscriptWriter, text, toolUse, writeTranscript } = await import(
  './_testing/claude-records'
);
const { importAgentSession } = await import('./import-agent-session');
const { readOwnedExternalSessionIds } = await import('./owned-sessions');

const WORK_ITEM = 'wi-ledger';
const OTHER_WORK_ITEM = 'wi-other';
const LANE = 'lane-ledger';
const OTHER_LANE = 'lane-other';
const laneDir = join(root, 'worktrees', 'raghav-ledger');
const otherLaneDir = join(root, 'worktrees', 'raghav-other');
const SENDER = { id: 'user-ana', name: 'Ana' };

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  removeDirSync(root);
});

interface WrittenSession {
  sessionId: string;
  file: string;
  promptAts: number[];
}

/** Two prompts and their replies, run by `claude` in the lane folder. */
function writeOutsideSession(
  prompts: [string, string] = ['Migrate the ledger job.', 'Thanks — now the tests.']
): WrittenSession {
  const sessionId = randomUUID();
  const writer = new ClaudeTranscriptWriter({
    sessionId,
    cwd: laneDir,
    startAt: Date.parse('2026-10-02T08:00:00.000Z'),
  });
  const promptAts: number[] = [];
  promptAts.push(writer.nextAt);
  writer.prompt(prompts[0]);
  const [, bash] = writer.assistant([
    text('Migrating.'),
    toolUse('toolu_01Mig', 'Bash', { command: 'pnpm migrate' }),
  ]);
  writer.toolResult(bash, 'toolu_01Mig', 'migrated 3 jobs');
  writer.assistant([text('Done.')]);
  promptAts.push(writer.nextAt);
  writer.prompt(prompts[1]);
  writer.assistant([text('Tests pass.')]);
  writer.meta({ type: 'ai-title', aiTitle: 'Ledger job migration' });
  const file = writeTranscript(
    join(configDir, 'projects', encodeClaudeProjectDir(laneDir)),
    sessionId,
    writer
  );
  return { sessionId, file, promptAts };
}

function sessionRowsFor(externalSessionId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.externalSessionId, externalSessionId))
    .all();
}

function messagesOf(sessionId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt), sql`rowid`)
    .all();
}

function importInto(
  session: WrittenSession,
  overrides: Partial<Parameters<typeof importAgentSession>[0]> = {}
) {
  return importAgentSession({
    workItemId: WORK_ITEM,
    worktreeId: LANE,
    providerId: 'claude',
    providerSessionId: session.sessionId,
    sender: SENDER,
    ...overrides,
  });
}

beforeEach(async () => {
  await db.delete(syncQueue);
  await db.delete(chatMessages);
  await db.delete(agentSessions);
  await db.delete(workItemWorktrees);
  await db.delete(workItems);
  await db.delete(repos);
  mkdirSync(laneDir, { recursive: true });
  mkdirSync(otherLaneDir, { recursive: true });
  await db.insert(repos).values({ id: 'r-1', alias: 'ledger', path: join(root, 'repo') });
  await db.insert(workItems).values([
    { id: WORK_ITEM, repoId: 'r-1', repoPath: laneDir, name: 'Ledger', provisionStatus: 'ready' },
    {
      id: OTHER_WORK_ITEM,
      repoId: 'r-1',
      repoPath: otherLaneDir,
      name: 'Other',
      provisionStatus: 'ready',
    },
  ]);
  await db.insert(workItemWorktrees).values([
    { id: LANE, workItemId: WORK_ITEM, path: laneDir, branchName: 'raghav/ledger', isPrimary: 1 },
    {
      id: OTHER_LANE,
      workItemId: OTHER_WORK_ITEM,
      path: otherLaneDir,
      branchName: 'raghav/other',
      isPrimary: 1,
    },
  ]);
});

describe('importAgentSession', () => {
  it('creates a resumable chat session bound to the lane, holding the Claude session id', async () => {
    const outside = writeOutsideSession();
    const result = await importInto(outside);
    if (!result.success) throw new Error(`import failed: ${JSON.stringify(result.error)}`);

    const [row] = sessionRowsFor(outside.sessionId);
    expect(row).toMatchObject({
      id: result.data.sessionId,
      workItemId: WORK_ITEM,
      kind: 'chat',
      agentProviderId: 'claude',
      communication: 'acp',
      externalSessionId: outside.sessionId,
      title: 'Ledger job migration',
      cwd: laneDir,
      status: 'suspended',
      worktreeId: LANE,
      lastActiveAt: Math.floor(statSync(outside.file).mtimeMs / 1000),
    });
    expect(result.data.messageCount).toBe(4);
  });

  it("writes the earlier messages in Chord's chat format, prompts as the user's, replies as the agent's", async () => {
    const outside = writeOutsideSession();
    const result = await importInto(outside);
    if (!result.success) throw new Error(`import failed: ${JSON.stringify(result.error)}`);

    const rows = messagesOf(result.data.sessionId);
    expect(rows.map((r) => [r.senderType, r.messageType, r.content])).toEqual([
      ['human', 'text', 'Migrate the ledger job.'],
      ['agent', 'agent_turn', ''],
      ['human', 'text', 'Thanks — now the tests.'],
      ['agent', 'agent_turn', ''],
    ]);
    expect(rows[0]).toMatchObject({
      workItemId: WORK_ITEM,
      senderId: 'user-ana',
      senderName: 'Ana',
      createdAt: Math.floor(outside.promptAts[0] / 1000),
      createdAtMs: outside.promptAts[0],
    });
    // Already delivered to this agent: never replayed into a later prompt's
    // thread digest (`thread-digest.ts` skips agent_prompt rows).
    expect(JSON.parse(rows[0].metadata ?? '{}')).toEqual({ agent_prompt: true });

    const turn = JSON.parse(rows[1].metadata ?? '{}');
    expect(rows[1].senderName).toBe('Claude Code');
    expect(rows[1].turnId).toBe(turn.turnId);
    expect(turn.items.map((i: { kind: string }) => i.kind)).toEqual(['text', 'tool_group', 'text']);
    expect(turn.items[1].tools[0]).toMatchObject({
      callId: 'toolu_01Mig',
      name: 'Bash',
      status: 'completed',
      contentBlocks: [{ type: 'text', text: 'migrated 3 jobs' }],
    });
    expect(rows[1].createdAt).toBe(Math.floor(turn.completedAt / 1000));
    expect(rows[1].createdAtMs).toBe(turn.completedAt);
  });

  it('queues the imported messages for the cloud like any work-item chat', async () => {
    const outside = writeOutsideSession();
    const result = await importInto(outside);
    if (!result.success) throw new Error(`import failed: ${JSON.stringify(result.error)}`);

    const queued = db
      .select()
      .from(syncQueue)
      .where(and(eq(syncQueue.entityType, 'chat_message_bulk'), eq(syncQueue.entityId, WORK_ITEM)))
      .all();
    expect(queued).toHaveLength(1);
    const payload = JSON.parse(queued[0].payload) as {
      messages: { id: string; session_id: string }[];
    };
    expect(payload.messages.map((m) => m.id)).toEqual(
      messagesOf(result.data.sessionId).map((r) => r.id)
    );
    expect(new Set(payload.messages.map((m) => m.session_id))).toEqual(
      new Set([result.data.sessionId])
    );
  });

  it('refuses to import the same session twice, and writes nothing the second time', async () => {
    const outside = writeOutsideSession();
    const first = await importInto(outside);
    if (!first.success) throw new Error('first import failed');
    const second = await importInto(outside);

    expect(second).toEqual({
      success: false,
      error: { type: 'already_imported', sessionId: first.data.sessionId, workItemId: WORK_ITEM },
    });
    expect(sessionRowsFor(outside.sessionId)).toHaveLength(1);
    expect(db.select().from(chatMessages).all()).toHaveLength(4);
  });

  it('lets only one of two imports started together through', async () => {
    const outside = writeOutsideSession();
    const results = await Promise.all([importInto(outside), importInto(outside)]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success).map((r) => !r.success && r.error.type)).toEqual([
      'already_imported',
    ]);
    expect(sessionRowsFor(outside.sessionId)).toHaveLength(1);
    expect(db.select().from(chatMessages).all()).toHaveLength(4);
  });

  it('refuses a session another work item already holds, naming it', async () => {
    const outside = writeOutsideSession();
    await db.insert(agentSessions).values({
      id: 'chord-owned',
      workItemId: OTHER_WORK_ITEM,
      kind: 'chat',
      agentProviderId: 'claude',
      communication: 'acp',
      externalSessionId: outside.sessionId,
      worktreeId: OTHER_LANE,
      status: 'suspended',
    });
    expect(await importInto(outside)).toEqual({
      success: false,
      error: { type: 'already_imported', sessionId: 'chord-owned', workItemId: OTHER_WORK_ITEM },
    });
  });

  it('writes nothing when the database refuses a row midway', async () => {
    // A real SQLite failure on the third row — the session row and the first
    // two messages are already written inside the transaction by then.
    db.run(sql`CREATE TRIGGER poison_import BEFORE INSERT ON chat_messages
               WHEN NEW.content LIKE '%POISON%'
               BEGIN SELECT RAISE(ABORT, 'poisoned row'); END`);
    try {
      const outside = writeOutsideSession(['Migrate the ledger job.', 'POISON pill']);
      const result = await importInto(outside);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toEqual({
        type: 'write_failed',
        message: expect.stringContaining('poisoned row'),
      });
      expect(sessionRowsFor(outside.sessionId)).toEqual([]);
      expect(db.select().from(chatMessages).all()).toEqual([]);
      expect(db.select().from(syncQueue).all()).toEqual([]);
    } finally {
      db.run(sql`DROP TRIGGER poison_import`);
    }
  });

  it('says the session is gone when Claude Code no longer has it', async () => {
    const result = await importInto({ sessionId: randomUUID(), file: '', promptAts: [] });
    expect(result).toEqual({ success: false, error: { type: 'session_not_found' } });
    expect(db.select().from(agentSessions).all()).toEqual([]);
  });

  it('reports a transcript it cannot read as a read failure, writing nothing', async () => {
    const outside = writeOutsideSession();
    const { appendFileSync } = await import('node:fs');
    appendFileSync(outside.file, '{"type":"user","message":\n');
    const result = await importInto(outside);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('read_failed');
    expect(db.select().from(agentSessions).all()).toEqual([]);
    expect(db.select().from(chatMessages).all()).toEqual([]);
  });

  it('refuses a lane of another work item, and a lane whose folder is not there', async () => {
    const outside = writeOutsideSession();
    expect(await importInto(outside, { worktreeId: OTHER_LANE })).toEqual({
      success: false,
      error: { type: 'lane_not_found' },
    });
    rmSync(laneDir, { recursive: true, force: true });
    expect(await importInto(outside)).toEqual({
      success: false,
      error: { type: 'lane_not_checked_out' },
    });
  });

  it('refuses a work item whose checkout is still being created', async () => {
    const outside = writeOutsideSession();
    await db
      .update(workItems)
      .set({ provisionStatus: 'provisioning' })
      .where(eq(workItems.id, WORK_ITEM));
    expect(await importInto(outside)).toEqual({
      success: false,
      error: { type: 'lane_not_checked_out' },
    });
  });

  it('refuses an agent that has no way to list or load its sessions', async () => {
    const outside = writeOutsideSession();
    expect(await importInto(outside, { providerId: 'gemini' })).toEqual({
      success: false,
      error: { type: 'provider_unsupported', providerId: 'gemini' },
    });
  });
});

describe('readOwnedExternalSessionIds', () => {
  it("is every agent-side id Chord's sessions hold, in any work item", async () => {
    await db.insert(agentSessions).values([
      {
        id: 's1',
        workItemId: WORK_ITEM,
        kind: 'chat',
        externalSessionId: 'claude-1',
        status: 'done',
      },
      {
        id: 's2',
        workItemId: OTHER_WORK_ITEM,
        kind: 'terminal',
        externalSessionId: 'claude-2',
        status: 'active',
      },
      { id: 's3', workItemId: WORK_ITEM, kind: 'chat', externalSessionId: null, status: 'active' },
    ]);
    expect(readOwnedExternalSessionIds()).toEqual(new Set(['claude-1', 'claude-2']));
  });
});
