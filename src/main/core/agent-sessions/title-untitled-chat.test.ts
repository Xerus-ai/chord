/**
 * A chat opened from the + menu has no title, so every surface named it after
 * its agent — two Codex chats in one lane both read "Codex" (devstation-d8lx),
 * while a chat started by a first send was titled by that message. The first
 * message a titleless chat receives now titles it the same way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Real SQLite from the shipped migrations, as in session-row-summaries.test.ts. */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { eq } = await import('drizzle-orm');
const { db } = await import('@main/db/client');
const { agentSessions, repos, workItems } = await import('@main/db/schema-work-items');
const { titleUntitledChat } = await import('./title-untitled-chat');

async function titleOf(id: string): Promise<string | null> {
  const [row] = await db.select().from(agentSessions).where(eq(agentSessions.id, id)).limit(1);
  return row.title;
}

beforeEach(async () => {
  await db.delete(agentSessions);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: 'r-1', alias: 'chord', path: '/tmp/chord' });
  await db
    .insert(workItems)
    .values({ id: 'w-1', repoId: 'r-1', repoPath: '/tmp/chord', name: 'Restart' });
  await db.insert(agentSessions).values([
    { id: 'chat-untitled', workItemId: 'w-1', kind: 'chat', status: 'active' },
    { id: 'chat-titled', workItemId: 'w-1', kind: 'chat', status: 'active', title: 'Named' },
    { id: 'terminal', workItemId: 'w-1', kind: 'terminal', status: 'active' },
  ]);
});

describe('titleUntitledChat', () => {
  it('titles a titleless chat with its first message, trimmed', async () => {
    const titled = await titleUntitledChat('chat-untitled', '  Remember the codeword ALPHA-7.  ');

    expect(titled).toBe(true);
    expect(await titleOf('chat-untitled')).toBe('Remember the codeword ALPHA-7.');
  });

  it('keeps the first 120 characters of a long message', async () => {
    await titleUntitledChat('chat-untitled', 'x'.repeat(300));

    expect(await titleOf('chat-untitled')).toBe('x'.repeat(120));
  });

  it('never renames a chat that has a title', async () => {
    const titled = await titleUntitledChat('chat-titled', 'Later message');

    expect(titled).toBe(false);
    expect(await titleOf('chat-titled')).toBe('Named');
  });

  it('leaves terminals alone', async () => {
    expect(await titleUntitledChat('terminal', 'npm test')).toBe(false);
    expect(await titleOf('terminal')).toBeNull();
  });

  it('does not title a chat with a blank message', async () => {
    expect(await titleUntitledChat('chat-untitled', '   ')).toBe(false);
    expect(await titleOf('chat-untitled')).toBeNull();
  });

  it('throws for a session that does not exist', async () => {
    await expect(titleUntitledChat('missing', 'hello')).rejects.toThrow(/missing/);
  });
});
