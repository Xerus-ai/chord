import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureTurnCheckpoint } from '@main/core/checkpoints/checkpoint-service';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { checkpoints } from '@main/db/schema-checkpoints';
import {
  agentSessions,
  chatMessages,
  repos,
  workItems,
  workItemWorktrees,
} from '@main/db/schema-work-items';
import { CLAUDE_SESSION_ID, CLAUDE_TURN_1_REF, CLAUDE_TURN_2_REF } from './seed-transcripts';

/**
 * A Claude chat with two finished turns on a real lane: Ada's prompt, then
 * turn 1, which wrote `notes.txt` = "one"; her second prompt, then turn 2,
 * which rewrote it to "two". Each turn has its real checkpoint and its row in
 * the chat, history ref included. Uses whatever
 * `@main/db/client` the suite provides (a migrated test DB).
 */

export const WORK_ITEM_ID = 'wi-reset';
export const WORKTREE_ID = 'wt-reset';
export const SESSION_ID = 'session-reset';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

export interface ResetFixture {
  repo: string;
}

export async function clearResetTables(): Promise<void> {
  await db.delete(checkpoints);
  await db.delete(chatMessages);
  await db.delete(agentSessions);
  await db.delete(workItemWorktrees);
  await db.delete(workItems);
  await db.delete(repos);
}

async function insertPromptRow(id: string, content: string, createdAt: number) {
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

async function insertTurnRow(turnId: string, historyRef: string | null, createdAt: number) {
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

/** Builds the lane, the chat and both turns; `turn2HistoryRef: null` stores turn 2 without one. */
export async function buildResetFixture(
  opts: { turn2HistoryRef?: string | null } = {}
): Promise<ResetFixture> {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'chord-reset-lane-')));
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Chord Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  // Git for Windows sets core.autocrlf=true system-wide, so a restore would
  // write "one\r\n"; the suite compares exact bytes.
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'notes.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'base');

  await db.insert(repos).values({ id: 'repo-reset', alias: 'reset', path: repo });
  await db
    .insert(workItems)
    .values({ id: WORK_ITEM_ID, repoId: 'repo-reset', repoPath: repo, name: 'Reset' });
  await db
    .insert(workItemWorktrees)
    .values({ id: WORKTREE_ID, workItemId: WORK_ITEM_ID, path: repo, isPrimary: 1 });
  await db.insert(agentSessions).values({
    id: SESSION_ID,
    workItemId: WORK_ITEM_ID,
    kind: 'chat',
    agentProviderId: 'claude',
    communication: 'acp',
    externalSessionId: CLAUDE_SESSION_ID,
    worktreeId: WORKTREE_ID,
    status: 'suspended',
  });

  const checkpointArgs = {
    workItemId: WORK_ITEM_ID,
    sessionId: SESSION_ID,
    repoPath: repo,
    worktreeId: WORKTREE_ID,
  };
  writeFileSync(join(repo, 'notes.txt'), 'one\n');
  await insertPromptRow('prompt-1', 'Remember codeword ALPHA-17.', 90);
  await insertTurnRow('turn-1', CLAUDE_TURN_1_REF, 100);
  await captureTurnCheckpoint({ ...checkpointArgs, turnId: 'turn-1' });
  writeFileSync(join(repo, 'notes.txt'), 'two\n');
  const turn2Ref = opts.turn2HistoryRef === undefined ? CLAUDE_TURN_2_REF : opts.turn2HistoryRef;
  await insertPromptRow('prompt-2', 'Also remember codeword BRAVO-29.', 190);
  await insertTurnRow('turn-2', turn2Ref, 200);
  await captureTurnCheckpoint({ ...checkpointArgs, turnId: 'turn-2' });

  return { repo };
}

/** A finished turn the chat has but no checkpoint was taken for. */
export async function addTurnWithoutCheckpoint(turnId: string, historyRef: string): Promise<void> {
  await insertTurnRow(turnId, historyRef, 300);
}
