import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Real SQLite from the shipped migrations, as in session-launch-model.test.ts. */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { agentSessions, chatMessages, repos, workItems } = await import(
  '@main/db/schema-work-items'
);
const { readSessionRowSummaries } = await import('./session-row-summaries');

const WORK_ITEM_ID = 'w-1';
const OTHER_WORK_ITEM_ID = 'w-2';

let messageSeq = 0;

async function seed(): Promise<void> {
  await db.insert(repos).values({ id: 'r-1', alias: 'chord', path: '/tmp/chord' });
  await db.insert(workItems).values([
    { id: WORK_ITEM_ID, repoId: 'r-1', repoPath: '/tmp/chord', name: 'Right rail' },
    { id: OTHER_WORK_ITEM_ID, repoId: 'r-1', repoPath: '/tmp/chord2', name: 'Other' },
  ]);
}

async function addSession(id: string, workItemId = WORK_ITEM_ID): Promise<void> {
  await db.insert(agentSessions).values({ id, workItemId, kind: 'chat', status: 'active' });
}

async function addMessage(args: {
  workItemId?: string;
  sessionId: string | null;
  content: string;
  messageType?: string;
  createdAt?: number;
  createdAtMs?: number;
}): Promise<void> {
  messageSeq += 1;
  await db.insert(chatMessages).values({
    id: `m-${messageSeq}`,
    workItemId: args.workItemId ?? WORK_ITEM_ID,
    sessionId: args.sessionId,
    senderType: 'human',
    content: args.content,
    messageType: args.messageType ?? 'text',
    createdAt: args.createdAt ?? messageSeq,
    createdAtMs: args.createdAtMs ?? (args.createdAt ?? messageSeq) * 1000,
  });
}

function summaryFor(workItemId: string, sessionId: string) {
  return readSessionRowSummaries(workItemId).find((row) => row.sessionId === sessionId);
}

beforeEach(async () => {
  messageSeq = 0;
  await db.delete(chatMessages);
  await db.delete(agentSessions);
  await db.delete(workItems);
  await db.delete(repos);
  await seed();
});

describe('readSessionRowSummaries', () => {
  it('counts every message attributed to a session', async () => {
    await addSession('s-1');
    await addMessage({ sessionId: 's-1', content: 'first' });
    await addMessage({ sessionId: 's-1', content: 'second' });
    expect(summaryFor(WORK_ITEM_ID, 's-1')?.messageCount).toBe(2);
  });

  // An agent turn stores its items in `metadata` and leaves `content` empty
  // (persist-agent-turn.ts). It is still a message that happened, so it counts
  // — but it can never be the preview, which would otherwise render blank.
  it('counts agent turns but never previews them', async () => {
    await addSession('s-1');
    await addMessage({ sessionId: 's-1', content: 'what should we do', createdAt: 1 });
    await addMessage({ sessionId: 's-1', content: '', messageType: 'agent_turn', createdAt: 2 });
    const summary = summaryFor(WORK_ITEM_ID, 's-1');
    expect(summary?.messageCount).toBe(2);
    expect(summary?.preview).toBe('what should we do');
  });

  it('previews the most recent message that has text', async () => {
    await addSession('s-1');
    await addMessage({ sessionId: 's-1', content: 'older', createdAt: 10 });
    await addMessage({ sessionId: 's-1', content: 'newest', createdAt: 20 });
    expect(summaryFor(WORK_ITEM_ID, 's-1')?.preview).toBe('newest');
  });

  // A prompt sent right after a Reset shares the marker's second
  // (devstation-vihv); the line must still be the prompt.
  it('previews the most recent message to the millisecond', async () => {
    await addSession('s-1');
    // Written first, so it does not win on insert order or id either.
    await addMessage({ sessionId: 's-1', content: 'newest', createdAt: 30, createdAtMs: 30_900 });
    await addMessage({ sessionId: 's-1', content: 'older', createdAt: 30, createdAtMs: 30_100 });
    expect(summaryFor(WORK_ITEM_ID, 's-1')?.preview).toBe('newest');
  });

  // A session that exists but has said nothing is a real zero, not unknown:
  // the map lists LOCAL agent_sessions rows, and a local session's messages
  // are written locally under its own id.
  it('reports a session with no messages as zero, not as missing', async () => {
    await addSession('s-quiet');
    const summary = summaryFor(WORK_ITEM_ID, 's-quiet');
    expect(summary).toBeDefined();
    expect(summary?.messageCount).toBe(0);
    expect(summary?.preview).toBeNull();
  });

  // `chat_messages.session_id` is provenance, not a foreign key: cloud ingest
  // writes teammates' session ids, which have no local agent_sessions row
  // (chat-ingestion.ts:57). Those rows must not invent a summary, and must not
  // be added to anyone else's count.
  it('ignores messages whose session id has no local session row', async () => {
    await addSession('s-1');
    await addMessage({ sessionId: 's-1', content: 'mine' });
    await addMessage({ sessionId: 'remote-device-session', content: 'a teammate' });
    const summaries = readSessionRowSummaries(WORK_ITEM_ID);
    expect(summaries.map((row) => row.sessionId)).toEqual(['s-1']);
    expect(summaries[0].messageCount).toBe(1);
  });

  it('ignores messages that belong to no session at all', async () => {
    await addSession('s-1');
    await addMessage({ sessionId: 's-1', content: 'mine' });
    await addMessage({ sessionId: null, content: 'room chat' });
    expect(summaryFor(WORK_ITEM_ID, 's-1')?.messageCount).toBe(1);
  });

  it('does not leak another work item’s sessions or counts', async () => {
    await addSession('s-1');
    await addSession('s-other', OTHER_WORK_ITEM_ID);
    await addMessage({ sessionId: 's-1', content: 'mine' });
    await addMessage({
      workItemId: OTHER_WORK_ITEM_ID,
      sessionId: 's-other',
      content: 'theirs',
    });
    expect(readSessionRowSummaries(WORK_ITEM_ID).map((row) => row.sessionId)).toEqual(['s-1']);
  });

  it('returns one summary per session of the work item, counted independently', async () => {
    await addSession('s-1');
    await addSession('s-2');
    await addMessage({ sessionId: 's-1', content: 'one' });
    await addMessage({ sessionId: 's-2', content: 'two' });
    await addMessage({ sessionId: 's-2', content: 'three' });
    const byId = new Map(readSessionRowSummaries(WORK_ITEM_ID).map((row) => [row.sessionId, row]));
    expect(byId.size).toBe(2);
    expect(byId.get('s-1')?.messageCount).toBe(1);
    expect(byId.get('s-2')?.messageCount).toBe(2);
  });
});
