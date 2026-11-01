import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `chat_messages.created_at_ms` orders a chat within a second
 * (devstation-vihv). Rows written before it existed get the start of their
 * second, so the chats already on a device keep the order they had. Replayed
 * on a real SQLite (`node:sqlite`), as branch-prefix-mode-migration.test.ts
 * does.
 */

interface Statement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

const drizzleDir = fileURLToPath(new URL('../../../drizzle/', import.meta.url));

function openDatabase(): Database {
  const { DatabaseSync } = (
    process as unknown as { getBuiltinModule(id: string): unknown }
  ).getBuiltinModule('node:sqlite') as {
    DatabaseSync: new (
      path: string,
      options?: { enableForeignKeyConstraints?: boolean }
    ) => Database;
  };
  return new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
}

function migrationSql(tag: string): string {
  return readFileSync(`${drizzleDir}${tag}.sql`, 'utf8');
}

function apply(database: Database, tags: string[]): void {
  database.exec('BEGIN');
  for (const tag of tags) {
    for (const statement of migrationSql(tag).split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) database.exec(trimmed);
    }
  }
  database.exec('COMMIT');
}

function journalTags(): string[] {
  const journal = JSON.parse(readFileSync(`${drizzleDir}meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
}

describe('chat_messages.created_at_ms migration', () => {
  it('gives every existing row the start of its second', () => {
    const tags = journalTags();
    const at = tags.findIndex((tag) => /created_at_ms/.test(migrationSql(tag)));
    expect(at, 'no shipped migration adds created_at_ms').toBeGreaterThanOrEqual(0);

    const database = openDatabase();
    apply(database, tags.slice(0, at));
    database
      .prepare(
        `INSERT INTO chat_messages (id, work_item_id, sender_type, content, created_at)
         VALUES (?, 'wi-1', 'human', 'hi', ?)`
      )
      .run('m-1', 1_700_000_123);
    apply(database, tags.slice(at));

    const [row] = database
      .prepare("SELECT created_at, created_at_ms FROM chat_messages WHERE id = 'm-1'")
      .all() as Array<{ created_at: number; created_at_ms: number | null }>;
    expect(row.created_at_ms).toBe(1_700_000_123_000);
  });
});
