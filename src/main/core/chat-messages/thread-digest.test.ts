import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A real SQLite database, not a stubbed query builder: the digest is raw SQL
// (cursor comparison, ROWID ordering, the session scope), so anything faking
// the driver would be testing the fake. It has to be node:sqlite rather than
// better-sqlite3 — the installed better-sqlite3 binary is compiled for
// Electron's ABI and cannot load under the Node that runs vitest. Redirecting
// `@main/db/client` substitutes a real database for the on-disk one; it does
// not stub behaviour.
const sqlite = new DatabaseSync(':memory:');

vi.mock('@main/db/client', () => ({ sqlite }));
vi.mock('@main/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { buildThreadDigest } = await import('./thread-digest');

const WORK_ITEM = 'wi-1';
const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

sqlite.exec(`
  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    session_id TEXT,
    sender_type TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    metadata TEXT DEFAULT '{}',
    cloud_id TEXT,
    synced_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE agent_thread_cursors (
    session_id TEXT PRIMARY KEY,
    last_rowid INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

let seq = 0;
function insertMessage(overrides: {
  sessionId: string | null;
  content: string;
  senderType?: string;
  senderName?: string;
  messageType?: string;
  metadata?: string;
}): string {
  const id = `msg-${++seq}`;
  sqlite
    .prepare(
      `INSERT INTO chat_messages
         (id, work_item_id, session_id, sender_type, sender_name, content, message_type, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      WORK_ITEM,
      overrides.sessionId,
      overrides.senderType ?? 'human',
      overrides.senderName ?? 'Ana',
      overrides.content,
      overrides.messageType ?? 'text',
      overrides.metadata ?? '{}'
    );
  return id;
}

beforeEach(() => {
  sqlite.exec('DELETE FROM chat_messages; DELETE FROM agent_thread_cursors;');
  seq = 0;
});

describe('buildThreadDigest', () => {
  it('carries the thread own messages', () => {
    insertMessage({ sessionId: SESSION_A, content: 'ship it' });
    const digest = buildThreadDigest(WORK_ITEM, SESSION_A);
    expect(digest.prefix).toContain('Ana: ship it');
  });

  it('does not leak another thread messages into this one', () => {
    insertMessage({ sessionId: SESSION_B, content: 'meant for the other agent' });
    expect(buildThreadDigest(WORK_ITEM, SESSION_A).prefix).toBeNull();
  });

  // The bug the Room had: one work-item-wide cursor meant whichever agent
  // prompted first consumed the digest and the second never saw those
  // messages at all (plan §Why, strike 3).
  it('gives every thread the same message, independently of the other cursors', () => {
    insertMessage({ sessionId: null, content: 'everyone read this' });

    const first = buildThreadDigest(WORK_ITEM, SESSION_A);
    expect(first.prefix).toContain('everyone read this');
    first.commit();

    const second = buildThreadDigest(WORK_ITEM, SESSION_B);
    expect(second.prefix).toContain('everyone read this');
  });

  it('stops repeating a message to the thread that already saw it', () => {
    insertMessage({ sessionId: SESSION_A, content: 'once' });
    buildThreadDigest(WORK_ITEM, SESSION_A).commit();
    expect(buildThreadDigest(WORK_ITEM, SESSION_A).prefix).toBeNull();
  });

  it('keeps work-item history with no session of its own in every thread', () => {
    insertMessage({ sessionId: null, content: 'from before threads existed' });
    expect(buildThreadDigest(WORK_ITEM, SESSION_A).prefix).toContain('from before threads existed');
  });

  it('leaves the cursor alone until the prompt actually reached the session', () => {
    insertMessage({ sessionId: SESSION_A, content: 'undelivered' });
    buildThreadDigest(WORK_ITEM, SESSION_A);
    expect(buildThreadDigest(WORK_ITEM, SESSION_A).prefix).toContain('undelivered');
  });

  it('excludes agent turns, system rows, prompt-command rows and the caller own row', () => {
    insertMessage({ sessionId: SESSION_A, content: 'agent reply', senderType: 'agent' });
    insertMessage({ sessionId: SESSION_A, content: 'system note', senderType: 'system' });
    insertMessage({
      sessionId: SESSION_A,
      content: 'delivered as a prompt',
      metadata: JSON.stringify({ agent_prompt: true }),
    });
    const own = insertMessage({ sessionId: SESSION_A, content: 'the prompt being sent' });
    expect(buildThreadDigest(WORK_ITEM, SESSION_A, [own]).prefix).toBeNull();
  });

  it('never drags a cursor backwards when two sends overlap', () => {
    insertMessage({ sessionId: SESSION_A, content: 'first' });
    const early = buildThreadDigest(WORK_ITEM, SESSION_A);
    insertMessage({ sessionId: SESSION_A, content: 'second' });
    const late = buildThreadDigest(WORK_ITEM, SESSION_A);

    late.commit();
    early.commit();

    expect(buildThreadDigest(WORK_ITEM, SESSION_A).prefix).toBeNull();
  });

  it('marks the digest as context and the prompt as the addressed message', () => {
    insertMessage({ sessionId: SESSION_A, content: 'chatter' });
    const wrapped = buildThreadDigest(WORK_ITEM, SESSION_A).wrap('do the thing');
    expect(wrapped).toMatch(/not addressed to you/i);
    expect(wrapped.indexOf('chatter')).toBeLessThan(wrapped.indexOf('do the thing'));
  });

  it('passes the prompt through untouched when nothing is unseen', () => {
    expect(buildThreadDigest(WORK_ITEM, SESSION_A).wrap('do the thing')).toBe('do the thing');
  });
});
