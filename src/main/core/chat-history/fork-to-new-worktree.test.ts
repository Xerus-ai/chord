import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fork to new worktree (plan §"Decisions for Phase 5"): a new lane in the same
 * work item, made from the turn checkpoint's parent commit with the
 * checkpoint's files applied uncommitted, and a new chat resuming the
 * conversation forked at the turn in the new lane's own folder. A real
 * repository, real lane provisioning (into a temp pool) and the real Agent
 * SDK fork; Electron's keychain and the database are the substitutes the
 * other suites use.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

// The SDK reads CLAUDE_CONFIG_DIR once, at first use.
const claudeConfigDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'chord-fork-wt-claude-')));
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

const { db } = await import('@main/db/client');
const { checkpoints } = await import('@main/db/schema-checkpoints');
const { repoSettings } = await import('@main/db/schema-repo-settings');
const { agentSessions, chatMessages, repos, workItems, workItemWorktrees } = await import(
  '@main/db/schema-work-items'
);
const { captureTurnCheckpoint } = await import('@main/core/checkpoints/checkpoint-service');
const { claudeConversationExists, resolveClaudeTranscriptPath } = await import(
  '@main/core/agent-sessions/claude-conversation-store'
);
const { addLane, createLaneRepo, git, insertRepoAndItems, REPO_ID, removeLaneRepo } = await import(
  '@main/core/lane-runs/_testing/lane-run-fixture'
);
const { archiveWorktree } = await import('@main/core/worktrees/archive-worktree');
const { CLAUDE_SESSION_ID, CLAUDE_TURN_1_REF, CLAUDE_TURN_2_REF, seedClaudeTranscript } =
  await import('./_testing/seed-transcripts');
const { forkToNewWorktree } = await import('./fork-to-new-worktree');

const WORK_ITEM_ID = 'item-f';
const SOURCE_LANE_ID = 'lane-s';
const SESSION_ID = 'session-f';

type LaneRepo = Awaited<ReturnType<typeof createLaneRepo>>;

let repo: LaneRepo;
let sourceLane: string;
/** The source lane's commit that turn 1 started from: its checkpoint's parent. */
let turn1Base: string;

async function insertPrompt(id: string, content: string, createdAt: number) {
  await db.insert(chatMessages).values({
    id,
    workItemId: WORK_ITEM_ID,
    sessionId: SESSION_ID,
    senderType: 'human',
    senderId: 'user-ada',
    senderName: 'Ada',
    content,
    messageType: 'text',
    metadata: '{}',
    createdAt,
    createdAtMs: createdAt * 1000,
  });
}

async function insertTurn(turnId: string, historyRef: string | null, createdAt: number) {
  await db.insert(chatMessages).values({
    id: `row-${turnId}`,
    workItemId: WORK_ITEM_ID,
    sessionId: SESSION_ID,
    senderType: 'agent',
    senderName: 'Claude',
    content: '',
    messageType: 'agent_turn',
    metadata: JSON.stringify({ turnId, items: [] }),
    turnId,
    historyRef,
    createdAt,
    createdAtMs: createdAt * 1000,
  });
}

async function checkpointTurn(turnId: string) {
  await captureTurnCheckpoint({
    workItemId: WORK_ITEM_ID,
    turnId,
    sessionId: SESSION_ID,
    repoPath: sourceLane,
    worktreeId: SOURCE_LANE_ID,
  });
}

beforeEach(async () => {
  db.delete(checkpoints).run();
  db.delete(chatMessages).run();
  db.delete(agentSessions).run();
  db.delete(workItemWorktrees).run();
  db.delete(workItems).run();
  db.delete(repoSettings).run();
  db.delete(repos).run();

  repo = await createLaneRepo('chord-fork-wt-');
  // Git for Windows sets core.autocrlf=true system-wide, so a restore would
  // write CRLF; the suite compares exact bytes.
  await git(['config', 'core.autocrlf', 'false'], repo.repoDir);
  insertRepoAndItems(repo.repoDir, [WORK_ITEM_ID]);
  // New lanes go to a temp pool, never the user's worktree root.
  db.insert(repoSettings)
    .values({
      repoId: REPO_ID,
      overrides: JSON.stringify({ worktreeFolder: path.join(repo.root, 'forks') }),
    })
    .run();
  await addLane({ repo, laneId: 'lane-p', workItemId: WORK_ITEM_ID, dir: 'p' });
  sourceLane = await addLane({
    repo,
    laneId: SOURCE_LANE_ID,
    workItemId: WORK_ITEM_ID,
    dir: 's',
    isPrimary: false,
  });
  await db.insert(agentSessions).values({
    id: SESSION_ID,
    workItemId: WORK_ITEM_ID,
    kind: 'chat',
    agentProviderId: 'claude',
    communication: 'acp',
    externalSessionId: CLAUDE_SESSION_ID,
    worktreeId: SOURCE_LANE_ID,
    cwd: sourceLane,
    status: 'suspended',
  });

  writeFileSync(path.join(sourceLane, 'work.md'), 'committed\n');
  await git(['add', 'work.md'], sourceLane);
  await git(['commit', '-m', 'work'], sourceLane);
  turn1Base = await git(['rev-parse', 'HEAD'], sourceLane);

  // Turn 1 edits work.md and adds notes.md, uncommitted.
  writeFileSync(path.join(sourceLane, 'work.md'), 'turn one\n');
  writeFileSync(path.join(sourceLane, 'notes.md'), 'one\n');
  await insertPrompt('prompt-1', 'Remember codeword ALPHA-17.', 90);
  await insertTurn('turn-1', CLAUDE_TURN_1_REF, 100);
  await checkpointTurn('turn-1');
  // Turn 2 commits, so the lane's branch moves past turn 1's base.
  writeFileSync(path.join(sourceLane, 'work.md'), 'turn two\n');
  await git(['add', '-A'], sourceLane);
  await git(['commit', '-m', 'turn two'], sourceLane);
  await insertPrompt('prompt-2', 'Also remember codeword BRAVO-29.', 190);
  await insertTurn('turn-2', CLAUDE_TURN_2_REF, 200);
  await checkpointTurn('turn-2');

  seedClaudeTranscript(claudeConfigDir, sourceLane);
});

afterEach(async () => {
  await removeLaneRepo(repo);
});

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  rmSync(claudeConfigDir, { recursive: true, force: true });
});

async function forkTurn1(): Promise<{ sessionId: string; worktreeId: string }> {
  const result = await forkToNewWorktree({ workItemId: WORK_ITEM_ID, turnId: 'turn-1' });
  if (!result.success) throw new Error(`fork refused: ${result.error.type}`);
  return result.data;
}

function laneRow(id: string) {
  return db.select().from(workItemWorktrees).where(eq(workItemWorktrees.id, id)).all()[0];
}

function sessionRow(id: string) {
  return db.select().from(agentSessions).where(eq(agentSessions.id, id)).all()[0];
}

async function expectTurn1Files(lanePath: string) {
  expect(await git(['rev-parse', 'HEAD'], lanePath)).toBe(turn1Base);
  expect(readFileSync(path.join(lanePath, 'work.md'), 'utf8')).toBe('turn one\n');
  expect(readFileSync(path.join(lanePath, 'notes.md'), 'utf8')).toBe('one\n');
  // Applied uncommitted, the index at HEAD.
  expect(await git(['diff', '--cached', '--name-only'], lanePath)).toBe('');
  // The fixture's git() trims its output, so the lines are compared trimmed. The new lane's
  // setup may still be reading this index; a status that rewrites it can fail setup's open on
  // Windows (devstation-jf83), so the test reads it the way the app does, without optional locks.
  const status = (await git(['--no-optional-locks', 'status', '--porcelain'], lanePath))
    .split('\n')
    .map((line) => line.trim());
  expect(status.sort()).toEqual(['?? notes.md', 'M work.md']);
}

describe('forkToNewWorktree (real DB, git, lane provisioning and Agent SDK fork)', () => {
  it("makes a new lane in the work item from turn 1's commit, with its files uncommitted", async () => {
    const { worktreeId } = await forkTurn1();

    const lane = laneRow(worktreeId);
    expect(lane).toMatchObject({
      workItemId: WORK_ITEM_ID,
      isPrimary: 0,
      title: 'fork',
      branchName: 'chord/p--fork',
      forkSha: turn1Base,
      archivedAt: null,
    });
    expect(path.dirname(lane.path)).toBe(path.join(repo.root, 'forks'));
    await expectTurn1Files(lane.path);
    // The source lane is untouched.
    expect(readFileSync(path.join(sourceLane, 'work.md'), 'utf8')).toBe('turn two\n');
  });

  it("resumes a fork of the conversation, cut at the turn, from the new lane's own folder", async () => {
    const { sessionId, worktreeId } = await forkTurn1();
    const lane = laneRow(worktreeId);

    const session = sessionRow(sessionId);
    expect(session).toMatchObject({
      workItemId: WORK_ITEM_ID,
      worktreeId,
      cwd: lane.path,
      kind: 'chat',
      agentProviderId: 'claude',
      title: 'Claude Code (fork)',
    });
    const externalId = session.externalSessionId as string;
    expect(externalId).not.toBe(CLAUDE_SESSION_ID);
    expect(claudeConversationExists(lane.path, externalId)).toBe(true);
    expect(resolveClaudeTranscriptPath(sourceLane, externalId)).toBeNull();
    const forked = readFileSync(
      resolveClaudeTranscriptPath(lane.path, externalId) as string,
      'utf8'
    );
    expect(forked).toContain('ALPHA-17');
    expect(forked).not.toContain('BRAVO-29');
    // The source chat keeps its whole conversation.
    expect(sessionRow(SESSION_ID).externalSessionId).toBe(CLAUDE_SESSION_ID);
    expect(claudeConversationExists(sourceLane, CLAUDE_SESSION_ID)).toBe(true);
  });

  it('copies the thread to the turn, and gives the copied turn a checkpoint on the new lane', async () => {
    const { sessionId, worktreeId } = await forkTurn1();

    const rows = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(sql`rowid`)
      .all();
    expect(rows.map((row) => row.messageType)).toEqual(['system', 'text', 'agent_turn']);
    expect(rows[0].content).toBe('Forked from Claude Code');
    const turn = rows[2];
    expect(turn.turnId).not.toBe('turn-1');

    const [source] = db.select().from(checkpoints).where(eq(checkpoints.turnId, 'turn-1')).all();
    const [copy] = db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.turnId, turn.turnId as string))
      .all();
    expect(copy).toMatchObject({
      commitSha: source.commitSha,
      sessionId,
      worktreeId,
      branchName: 'chord/p--fork',
      trigger: 'turn_completed',
    });
    expect(copy.id).not.toBe(source.id);
  });

  it("forks from an archived lane's turn: nothing needs the old checkout", async () => {
    const archived = await archiveWorktree(SOURCE_LANE_ID);
    expect(archived.success).toBe(true);
    expect(existsSync(sourceLane)).toBe(false);

    const { sessionId, worktreeId } = await forkTurn1();

    const lane = laneRow(worktreeId);
    await expectTurn1Files(lane.path);
    const externalId = sessionRow(sessionId).externalSessionId as string;
    expect(claudeConversationExists(lane.path, externalId)).toBe(true);
  });

  it('refuses a turn with no checkpoint or no history point, and makes no lane', async () => {
    await insertTurn('turn-3', 'ref-3', 300);
    await insertTurn('turn-4', null, 400);
    await checkpointTurn('turn-4');
    const lanesBefore = db.select().from(workItemWorktrees).all().length;

    const noCheckpoint = await forkToNewWorktree({ workItemId: WORK_ITEM_ID, turnId: 'turn-3' });
    expect(noCheckpoint.success ? null : noCheckpoint.error.type).toBe('no_checkpoint');
    const noPoint = await forkToNewWorktree({ workItemId: WORK_ITEM_ID, turnId: 'turn-4' });
    expect(noPoint.success ? null : noPoint.error.type).toBe('no_history_point');

    expect(db.select().from(workItemWorktrees).all()).toHaveLength(lanesBefore);
    expect(db.select().from(agentSessions).all()).toHaveLength(1);
  });
});
