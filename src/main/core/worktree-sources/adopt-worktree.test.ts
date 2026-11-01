import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * Adopting a checkout made outside Chord (plan §Phase 3 slice 6, Adopt): a
 * work item with one primary lane on the existing folder, marked as the
 * user's, and the agent sessions ticked in the dialog imported with their
 * history through slice 5's import. Real repositories, a real Claude config
 * directory, the real schema. `electron` is the test keychain because the
 * sync queue's import graph reaches the credential store; nothing is signed
 * in, so the queue records the upload and sends nothing.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const scratchHelpers = await import('./_testing/scratch-worktrees');
const { addWorktree, claudeWorktreePath, createScratchRepo, git, listGitWorktrees } =
  scratchHelpers;
const { pushCommitToOrigin, readCheckoutState } = scratchHelpers;
const scratch = createScratchRepo('chord-adopt-');
const configDir = path.join(scratch.root, 'claude-config');
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
const { ClaudeTranscriptWriter, text, writeTranscript } = await import(
  '@main/core/session-import/_testing/claude-records'
);
const { listWorktrees } = await import('@main/core/worktrees/service');
const { adoptWorktree } = await import('./adopt-worktree');
const { discoverRepoWorktrees } = await import('./discover-repo-worktrees');

const REPO_ID = 'repo-1';
const SENDER = { id: 'user-ana', name: 'Ana' };
const claudeX = addWorktree(scratch.repo, claudeWorktreePath(scratch.repo, 'x'), 'claude/x');
const projectDir = path.join(configDir, 'projects', encodeClaudeProjectDir(claudeX));

// The user's own state in the checkout: an ignored .env, an uncommitted edit
// and an untracked file. Adopting must leave every byte of it.
writeFileSync(path.join(claudeX, '.env'), 'FROM=worktree\n');
writeFileSync(path.join(claudeX, 'README.md'), '# scratch\nedited outside Chord\n');
writeFileSync(path.join(claudeX, 'notes.txt'), 'mine\n');

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  removeDirSync(scratch.root);
});

/** A two-prompt `claude` conversation run in the adopted folder, outside Chord. */
function writeOutsideSession(title: string, startAt: string): string {
  const sessionId = randomUUID();
  const writer = new ClaudeTranscriptWriter({
    sessionId,
    cwd: claudeX,
    startAt: Date.parse(startAt),
  });
  writer.prompt(`First prompt of ${title}`);
  writer.assistant([text('Working on it.')]);
  writer.prompt(`Second prompt of ${title}`);
  writer.assistant([text('Done.')]);
  writer.meta({ type: 'ai-title', aiTitle: title });
  writeTranscript(projectDir, sessionId, writer);
  return sessionId;
}

async function adopt(sessionIds: string[] = [], name = 'Ledger job migration') {
  const result = await adoptWorktree({
    repoId: REPO_ID,
    path: claudeX,
    name,
    sessions: sessionIds.map((providerSessionId) => ({
      providerId: 'claude' as const,
      providerSessionId,
    })),
    sender: SENDER,
  });
  if (!result.success) throw new Error(`adopt refused: ${JSON.stringify(result.error)}`);
  return result.data;
}

beforeAll(() => {
  // Origin moves on after the clone: adopting must not fetch it.
  pushCommitToOrigin(scratch, 'later.txt');
});

beforeEach(async () => {
  rmSync(projectDir, { recursive: true, force: true });
  await db.delete(syncQueue);
  await db.delete(chatMessages);
  await db.delete(agentSessions);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: REPO_ID, path: scratch.repo, alias: 'repo' });
});

describe('adoptWorktree', () => {
  it('creates a work item and one primary lane on the existing folder, marked as the user’s', async () => {
    const adopted = await adopt();

    const [item] = db.select().from(workItems).where(eq(workItems.id, adopted.workItemId)).all();
    expect(item).toMatchObject({
      name: 'Ledger job migration',
      repoId: REPO_ID,
      repoPath: claudeX,
      repoAlias: 'repo',
      branchName: 'claude/x',
      status: 'active',
      // Nothing to create: the checkout already exists.
      provisionStatus: 'ready',
      agentProvider: 'claude',
    });
    const lanes = db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.workItemId, adopted.workItemId))
      .all();
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({
      id: adopted.worktreeId,
      path: claudeX,
      branchName: 'claude/x',
      isPrimary: 1,
      checkoutOrigin: 'adopted',
      branchOrigin: 'user',
      slug: 'x',
      targetRef: 'origin/main',
      baseBranch: null,
      forkSha: null,
      forkSource: null,
      // No setup until the user asks for it with Run setup.
      setupStatus: 'skipped',
      setupLogPath: null,
    });
  });

  it('reads the target ref as this clone knows it, without fetching', async () => {
    const knownBefore = git(scratch.repo, 'rev-parse', 'refs/remotes/origin/main');
    const onOrigin = git(scratch.seed, 'rev-parse', 'HEAD');
    expect(knownBefore).not.toBe(onOrigin);

    const adopted = await adopt();

    expect(git(scratch.repo, 'rev-parse', 'refs/remotes/origin/main')).toBe(knownBefore);
    const [lane] = db
      .select()
      .from(workItemWorktrees)
      .where(eq(workItemWorktrees.id, adopted.worktreeId))
      .all();
    expect(lane.targetRef).toBe('origin/main');
  });

  it("leaves the checkout's files, branch and git's worktree list exactly as they were", async () => {
    const before = readCheckoutState(claudeX);
    const worktreesBefore = listGitWorktrees(scratch.repo);

    await adopt();
    // Setup is not run, not even later on its own.
    await new Promise((r) => setTimeout(r, 200));

    expect(readCheckoutState(claudeX)).toEqual(before);
    expect(listGitWorktrees(scratch.repo)).toBe(worktreesBefore);
  });

  it('queues the work item for the cloud like any new one', async () => {
    const adopted = await adopt();

    const queued = db
      .select()
      .from(syncQueue)
      .where(
        and(
          eq(syncQueue.entityType, 'work_item'),
          eq(syncQueue.operation, 'create'),
          eq(syncQueue.entityId, adopted.workItemId)
        )
      )
      .all();
    expect(queued).toHaveLength(1);
  });

  it('imports the ticked sessions with their history onto the lane, and only those', async () => {
    const ticked = writeOutsideSession('Ledger job migration', '2026-10-02T08:00:00.000Z');
    const unticked = writeOutsideSession('Unrelated chat', '2026-10-02T09:00:00.000Z');

    const adopted = await adopt([ticked]);

    expect(adopted.importFailures).toEqual([]);
    expect(adopted.imported).toEqual([
      { providerSessionId: ticked, sessionId: expect.any(String) },
    ]);
    const [session] = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.externalSessionId, ticked))
      .all();
    expect(session).toMatchObject({
      id: adopted.imported[0].sessionId,
      workItemId: adopted.workItemId,
      worktreeId: adopted.worktreeId,
      agentProviderId: 'claude',
      kind: 'chat',
      cwd: claudeX,
    });
    const messages = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, session.id))
      .all();
    expect(messages.map((m) => m.senderType)).toEqual(['human', 'agent', 'human', 'agent']);
    expect(messages[0].content).toBe('First prompt of Ledger job migration');
    expect(
      db.select().from(agentSessions).where(eq(agentSessions.externalSessionId, unticked)).all()
    ).toEqual([]);
  });

  it('keeps the adoption and names a ticked session it could not import', async () => {
    const held = writeOutsideSession('Ledger job migration', '2026-10-02T08:00:00.000Z');
    await db.insert(workItems).values({
      id: 'other-item',
      name: 'Other',
      repoId: REPO_ID,
      repoPath: scratch.repo,
      provisionStatus: 'ready',
    });
    await db.insert(agentSessions).values({
      id: 'held-by-other',
      workItemId: 'other-item',
      kind: 'chat',
      agentProviderId: 'claude',
      externalSessionId: held,
      status: 'suspended',
    });

    const adopted = await adopt([held]);

    expect(adopted.imported).toEqual([]);
    expect(adopted.importFailures).toEqual([
      {
        providerSessionId: held,
        error: { type: 'already_imported', sessionId: 'held-by-other', workItemId: 'other-item' },
      },
    ]);
    expect(
      db.select().from(workItems).where(eq(workItems.id, adopted.workItemId)).all()
    ).toHaveLength(1);
  });

  it('is no longer offered once adopted', async () => {
    expect((await discoverRepoWorktrees(REPO_ID)).map((w) => w.path)).toContain(claudeX);

    await adopt();

    expect((await discoverRepoWorktrees(REPO_ID)).map((w) => w.path)).not.toContain(claudeX);
  });

  it('shows the lane as adopted, with setup not run', async () => {
    const adopted = await adopt();

    expect(await listWorktrees(adopted.workItemId)).toEqual([
      expect.objectContaining({
        id: adopted.worktreeId,
        path: claudeX,
        isPrimary: true,
        checkoutOrigin: 'adopted',
        setupStatus: 'skipped',
        forkSource: null,
      }),
    ]);
  });
});

describe('checkout_origin', () => {
  it('reads every lane from before adoption existed as one Chord made', async () => {
    await db
      .insert(workItems)
      .values({ id: 'legacy-item', name: 'Legacy', repoPath: scratch.repo });
    db.run(
      sql`INSERT INTO work_item_worktrees (id, work_item_id, path, is_primary)
          VALUES ('legacy-lane', 'legacy-item', ${scratch.repo}, 1)`
    );

    const [row] = db.all<{ checkout_origin: string }>(
      sql`SELECT checkout_origin FROM work_item_worktrees WHERE id = 'legacy-lane'`
    );
    expect(row.checkout_origin).toBe('chord');
  });
});
